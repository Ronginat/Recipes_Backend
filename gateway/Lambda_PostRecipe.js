const AWS = require('aws-sdk');
const nanoid = require('nanoid');

AWS.config.update({region: process.env['REGION']});
const docClient = new AWS.DynamoDB.DocumentClient();
const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();
const lambda = new AWS.Lambda({
    region: AWS.config.region,
    apiVersion: '2015-03-31'
});


function setResponse(status, body){
    return {
        headers: {
            'Content-Type': 'application/json'},
        body: body,
        statusCode: status
    };
}

function dateToString() {
    return new Date().toISOString();
}

function getUser(token){
    const params = {
        AccessToken: token
    };
    return new Promise((resolve, reject) => {
        cognitoidentityserviceprovider.getUser(params, function(err, data) {
            if (err) {
                console.log(err); // an error occurred
                return reject(err);
            }
            else {
                console.log(data); // successful response
                return resolve({
                    "username": data.Username,
                    "sub": data.UserAttributes.find(attr => attr.Name === 'sub').Value
                });
            }    
        });
    });
}

function putRecipe(recipe) {
    const date = dateToString();

    const params = {
        TableName: process.env['RECIPE_TABLE'],
        Item: {
            'id' : recipe.id,
            'sharedKey': process.env['SHARED_KEY'],
            'name' : recipe.name,
            'description': recipe.description,
            'uploader': recipe.uploader,
            'categories': recipe.categories,
            'html': recipe.html,
            'creationDate': recipe.creationDate,
            'lastModifiedDate': date,
            'likes': 0,
            'isDeleted': false
        },
        ReturnValues: "ALL_NEW"
    };

    return new Promise((resolve, reject) => {
        // Call DynamoDB to add the item to the table
        docClient.put(params, function(err, data) {
            if (err) {
                console.log("Error recipe PUT", err);
                return reject(err);
            } 
            else {
                console.log("Success recipe PUT", data);
                // return the stored recipe
                return resolve(data.Attributes);
            }
        });
    });
}

/**
 * Trigger notification publisher lambda to notify users new recipe available
 * @param {any} recipe - Details of the new recipe
 */
function invokePublishLambda(recipe) {
    const payload = {
        "message": "click to view the recipe",
        "title": recipe.name + ", by " + recipe.uploader,
        "topic": process.env['NEW_RECIPE_TOPIC'],
        "id": recipe.id,
        "channel": "newRecipes",
        "messageAttributes": {
            "categories" : {
                "DataType": "String.Array",
                "StringValue": JSON.stringify(recipe.categories)
            }
        }
    };
    const params = {
        FunctionName: process.env['SNS_PUBLISH_LAMBDA'],
        InvocationType: 'Event',
        LogType: 'Tail',
        Payload: JSON.stringify(payload)
    };

    return new Promise((resolve, reject) => {
        lambda.invoke(params, (err,data) => {
            if (err) { 
                console.log(err, err.stack);
                reject(err);
            }
            else {
                console.log(data);
                return resolve(data);
            }
        });
    });
}

//#region Update User Details

/**
 * Add the posted recipe to user's "posted" attribute.
 * @param {string} userId - id of posting user
 * @param {string} recipeId - id of posted recipe
 */
function updateUserPostedRecipes(userId, recipeId) {
    const params = {
        TableName: process.env['USERS_TABLE'],
        Key: {
            id: userId
        },
        ConditionExpression: "attribute_exists(posted)",
        UpdateExpression: "SET posted = list_append(posted, :postValue)",
        ExpressionAttributeValues: {
            ":postValue": [recipeId]
        },
        ReturnValues: "NONE"
    };

    return new Promise((resolve, reject) => {
        docClient.update(params, (err, data) => {
            if(err) {
                console.log("Error user UPDATE", JSON.stringify(err, null, 2));
                reject(err);
            } else {
                console.log("Success user UPDATE", JSON.stringify(data));
                resolve(data.Attributes);
            }
        });
    });
}

//#endregion Update User Details

exports.handler = async (event, context, callback) => {
    console.log(event);

    const eventBody = JSON.parse(event['body']);
    
    try {
        const results = {};
                        //let username = await getUsername(event['multyValueHeaders']['Authorization'][0]['AccessToken']);
        const { username, sub } = await getUser(event['headers']['Authorization']);
        eventBody['recipe']['uploader'] = sub;
        console.log('userid: ' + eventBody.recipe.uploader);
        const newId = nanoid(12);
        eventBody['recipe']['id'] = newId;

        const storedRecipe = await putRecipe(eventBody.recipe);

        results['id'] = storedRecipe.id;
        storedRecipe.uploader = username;

        await Promise.all([
            invokePublishLambda(storedRecipe),
            updateUserPostedRecipes(sub, newId)
        ]);
        
        callback(null, setResponse(200, JSON.stringify(results)));
        
    } catch(err) {
        console.log('got error, ' + err);
        callback(null, setResponse(500, JSON.stringify({ "message": err })));
    }
};