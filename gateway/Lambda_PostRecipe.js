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

function putRecipe(recipe, date) {
    const params = {
        TableName: process.env['RECIPE_TABLE'],
        Item: {
            'id' : recipe.id,
            'sharedKey': process.env['SHARED_KEY'],
            'name' : recipe.name,
            'description': recipe.description,
            'uploader': recipe.uploader,
            'categories': recipe.categories,
            'creationDate': date,
            'lastModifiedDate': date,
            'likes': 0,
            'isDeleted': false
        }
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
 * Put recipe content (html string) in recipes table at 'content' partition.
 * @param {any} recipe 
 */
function putContent(recipe) {
    const params = {
        TableName: process.env['RECIPE_TABLE'],
        Item: {
            'id' : recipe.id,
            'sharedKey': process.env['CONTENT_KEY'], // hash key for recipe content is static 'content'
            'name' : recipe.name,
            'html': recipe.html,
            'lastModifiedDate': recipe.id, // sort key for content is recipe id. Each recipe can hold one content record
            'lastModifiedContent': recipe.lastModifiedDate
        }
    };

    return new Promise((resolve, reject) => {
        // Call DynamoDB to add the item to the table
        docClient.put(params, function(err, data) {
            if (err) {
                console.log("Error recipe content PUT", err);
                return reject(err);
            } 
            else {
                console.log("Success recipe content PUT", data);
                // return the stored recipe
                return resolve(data);
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

function checkInput(recipe) {
    const required = ['name', 'description', 'categories', 'html'];
    required.forEach(property => {
        if (!recipe.hasOwnProperty(property)) {
            throw "missing property! " + property;
        }
    });
    return true;
}

exports.handler = async (event, context, callback) => {
    console.log(event);

    const admins = ['f7ab604f-761d-4ca1-af89-6c446a78c7ed', '895b2d91-c939-4010-9c66-8df6891b8166'];
    const eventBody = JSON.parse(event['body']);
    
    try {
        const results = {};
        checkInput(eventBody); // will throw exception if needed
        //const { username, sub } = await getUser(event['multyValueHeaders']['Authorization'][0]['AccessToken']);
        const { username, sub } = await getUser(event['headers']['Authorization']);
        if (eventBody.uploader === undefined || !admins.includes(sub)) {
            eventBody['uploader'] = sub;
        }
        const newId = nanoid(12);
        eventBody['id'] = newId;

        const date = dateToString();
        await putRecipe(eventBody, date);
        eventBody.lastModifiedDate = date;
        await putContent(eventBody);

        results['id'] = eventBody.id;
        results['lastModifiedDate'] = eventBody.lastModifiedContent;
        eventBody.uploader = username;

        await Promise.all([
            invokePublishLambda(eventBody),
            updateUserPostedRecipes(sub, newId)
        ]);
        
        callback(null, setResponse(200, JSON.stringify(results)));
        
    } catch(err) {
        console.log('got error, ' + err);
        callback(null, setResponse(500, JSON.stringify({ "message": err })));
    }
};