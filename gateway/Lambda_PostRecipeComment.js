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
    let params = {
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

function getQueriedRecipe(recipeId) {
    const quey_params = {
        TableName: process.env['RECIPE_TABLE'],
        KeyConditionExpression: "sharedKey = :v_key",
        FilterExpression: "#id = :v_id",
        ExpressionAttributeNames: {
          "#id":  "id",
        },
        ExpressionAttributeValues: {
            ":v_key": process.env['SHARED_KEY'],
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
                    return reject("recipe not found");
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

function getUserFromDB(userId) {
    const params = {
        TableName: process.env['USERS_TABLE'],
        Key: {
            "id" : userId
        },
        ProjectionExpression: "username, devices"
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
                    return reject("user not found, " + userId);
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
        if(event['pathParameters'] !== undefined && event['pathParameters']['id'] !== undefined) {
            id = event['pathParameters']['id'];
        } else {
            throw {
                code: 400, // Bad Request
                message: "request must contain recipe id"
            };
        }

        const request = JSON.parse(event['body']);
        const { username, sub } = await getUser(event['headers']['Authorization']);

        await postComment(id, request['comment'], sub, dateToString());
        posted = true;
        //console.log('results, ' +  JSON.stringify(results));

        callback(null, setResponse(200));

        //#region PublishSNS
        
        await handlePushNotifications(id, username);

        //#endregion PublishSNS
    }
    catch(err) {
        //callback(err);
        //callback(null, setResponse(500, err));
        console.log("comment posted ? " + posted + " catch error, " + err);
        if(!posted) {
            const { code, message } = err;
            if (message !== undefined && code !== undefined) {
                callback(null, setErrorResponse(code, JSON.stringify({"message": message})));
            } else {
                callback(null, setErrorResponse(500, JSON.stringify({"message": err})));
            }   
        }
    }

};