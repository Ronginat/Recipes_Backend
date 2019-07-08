const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});
const docClient = new AWS.DynamoDB.DocumentClient();
const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();
const lambda = new AWS.Lambda({
    region: AWS.config.region,
    apiVersion: '2015-03-31'
});

function setResponse(status){
    return {
        headers: {
            'Content-Type': 'application/json'},
        statusCode: status
    };
}

function setErrorResponse(status, err){
    return {
        headers: {
            'Content-Type': 'application/json'},
        body: err,
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

function getQueriedRecipe(recipeId) {
    const quey_params = {
        TableName: process.env['RECIPE_TABLE'],
        KeyConditionExpression: "partitionKey = :v_key",
        FilterExpression: "#id = :v_id",
        ExpressionAttributeNames: {
          "#id":  "id"
        },
        ExpressionAttributeValues: {
            ":v_key": process.env['RECIPES_PARTITION'],
            ":v_id": recipeId
        },
        ReturnConsumedCapacity: "TOTAL"
    };

    return new Promise((resolve, reject) => {
        docClient.query(quey_params, (err, data) => {
            if (err) {
                console.error("Unable to query the table. Error JSON:", JSON.stringify(err, null, 2));
                return reject(err);
            } else {
                // print all the data
                console.log("Query succeeded. ", JSON.stringify(data));
                if (data.Items.length > 1) {
                    console.log('Oh no! there are more recipes with ' + recipeId + ' id');
                }
                if(data.Count === 0 || data.Items.length === 0) {
                    return reject({
                        statusCode: 500,
                        message: "recipe not found"
                    });
                }
                return resolve(data.Items[0]);
            }
        });
    });
}


function postComment(recipeId, comment, username, date) {
    // const date = dateToString();
    const params = {
        TableName: process.env['RECIPE_COMMENT_TABLE'],
        Item: {
            'recipeId' : recipeId,
            'creationDate': date,
            'user': username,
            'message': comment
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
                return resolve(data);
            }
        });
    });
}

//#region SNS Methods

function getUserFromDB(username) {
    const params = {
        TableName: process.env['RECIPE_TABLE'],
        Key: {
            partitionKey: process.env['USERS_PARTITION'],
            sort : username
        },
        ProjectionExpression: "#username, devices",
        ExpressionAttributeNames: {
            "#username": "sort"
        }
    };

    return new Promise((resolve, reject) => {
        docClient.get(params, (err, data) => {
            if (err) {
                console.error("Couldn't get the user. Error JSON:", JSON.stringify(err, null, 2));
                reject(err);
            } else {
                // print all the data
                console.log("Get succeeded. ", JSON.stringify(data));
                if(data.Item === undefined)
                    return reject({
                        statusCode: 500,
                        message: "user not found, " + username
                    });
                resolve(data.Item);
            }
        });
    });
}

function invokePublishLambda(payload) {
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
                resolve(data);
            }
        });
    });
}

// push notification to the uploader of this recipe (recipeUploader) about new comment by a user (someUser)
async function handlePushNotifications(id, someUser) {
    const recipe = await getQueriedRecipe(id);
    const recipeUploader = await getUserFromDB(recipe.uploader);
    if(recipeUploader.devices !== undefined) {
        for(let deviceId in recipeUploader.devices) {
            const subscriptions = recipeUploader.devices[deviceId].subscriptions;
            if(subscriptions !== undefined && 
                subscriptions.comments !== undefined &&
                subscriptions.comments === true) {
                    await invokePublishLambda({
                        "message": "click to view the comment",
                        "title": someUser + " commented on your recipe",
                        "target": recipeUploader.devices[deviceId].endpoint,
                        "id": recipe.id,
                        "channel": "comments"
                    });
            }
        }
    }
}

//#endregion SNS Methods


exports.handler = async (event, context, callback) => {
    let id = undefined, posted = false;
    //console.log(event['body']);

    try {
        if(event['pathParameters'] && event['pathParameters']['id']) {
            id = event['pathParameters']['id'];
        } else {
            throw {
                statusCode: 400, // Bad Request
                message: "request must contain recipe id"
            };
        }

        const request = JSON.parse(event['body']);
        const username = await getUser(event['headers']['Authorization']);

        await postComment(id, request['comment'], username, dateToString());
        posted = true;
        //console.log('results, ' +  JSON.stringify(results));

        callback(null, setResponse(201)); // Created

        //#region PublishSNS
        
        await handlePushNotifications(id, username);

        //#endregion PublishSNS
    }
    catch(err) {
        //callback(err);
        console.log("comment posted ? " + posted + " catch error, " + JSON.stringify(err));
        if(!posted) {
            callback(null, setErrorResponse(
                err.statusCode && err.statusCode === 400 ? 400 : 500, 
                JSON.stringify(err.message ? err.message : err))
            );
            /* const { code, message } = err;
            if (message !== undefined && code !== undefined) {
                callback(null, setErrorResponse(code, JSON.stringify({"message": message})));
            } else {
                callback(null, setErrorResponse(500, JSON.stringify({"message": err})));
            }    */
        }
    }
};