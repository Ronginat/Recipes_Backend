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
                return resolve(data.Username);
            }    
        });
    });
}

function putRecipe(recipe, date) {
    const params = {
        TableName: process.env['RECIPE_TABLE'],
        Item: {
            'partitionKey': process.env['RECIPES_PARTITION'],
            'sort': date, // lastModifiedDate
            'id' : recipe.id,
            'name' : recipe.name,
            'description': recipe.description,
            'author': recipe.author,
            'categories': recipe.categories,
            'lastModifiedDate': date, // duplicate of sort key, convenience attribute 
            'creationDate': date,
            'likes': 0
            //'isDeleted': false
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
            'partitionKey': process.env['CONTENT_PARTITION'], // hash key for recipe content is static 'content'
            'sort' : recipe.id, // sort key for content is recipe id. Each recipe can hold one content record
            'id': recipe.id, // duplicate attribute for convenience
            'name' : recipe.name,
            'html': recipe.html,
            'lastModifiedDate': recipe.lastModifiedDate
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
        "title": recipe.name + ", by " + recipe.author,
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
 * @param {string} username - username of posting user
 * @param {string} recipeId - id of posted recipe
 */
function updateUserPostedRecipes(username, recipeId) {
    const params = {
        TableName: process.env['RECIPE_TABLE'],
        Key: {
            partitionKey: process.env['USERS_PARTITION'],
            sort: username
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
    console.log(JSON.stringify(event));

    const admins = ['admin'];
    const eventBody = JSON.parse(event['body']);
    
    try {
        const results = {};
        checkInput(eventBody); // will throw exception if needed
        //const { username, sub } = await getUser(event['multyValueHeaders']['Authorization'][0]['AccessToken']);
        const username = await getUser(event['headers']['Authorization']);
        if (eventBody.author === undefined || !admins.includes(username)) {
            eventBody['author'] = username;
        }
        const newId = nanoid(12);
        eventBody.id = newId;

        const date = dateToString();
        await putRecipe(eventBody, date);
        eventBody.lastModifiedDate = date;
        await putContent(eventBody);

        results['id'] = eventBody.id;
        results['lastModifiedDate'] = eventBody.lastModifiedDate;
        eventBody.author = username;

        await Promise.all([
            invokePublishLambda(eventBody),
            updateUserPostedRecipes(username, newId)
        ]);
        
        console.log('results', JSON.stringify(results));
        callback(null, setResponse(201, JSON.stringify(results))); // Created
        
    } catch(err) {
        console.log('got error, ' + JSON.stringify(err));
        callback(null, setResponse(500, JSON.stringify(err.message ? err.message : err)));
    }
};