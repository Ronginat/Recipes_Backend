const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});
const docClient = new AWS.DynamoDB.DocumentClient();
const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();
const lambda = new AWS.Lambda({
    region: AWS.config.region,
    apiVersion: '2015-03-31'
});
const admins = ['f7ab604f-761d-4ca1-af89-6c446a78c7ed', '895b2d91-c939-4010-9c66-8df6891b8166'];
const freePatch = ["likes"];
//const freePatchGetUserName = ["comments"];
const authPatch = ["name", "description", "categories", "html"];
const forbidPatch = ["id", "recipeFile", "foodFiles", "createdAt", "sharedKey", "uploader", "lastModifiedDate"];


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

//#region PATCH recipe Methods

function getRecipe(sortKey) {
    const get_params = {
        TableName: process.env['RECIPE_TABLE'],
        Key: {
            "sharedKey": process.env['SHARED_KEY'],
            "lastModifiedDate": sortKey
        }
    };

    return new Promise((resolve, reject) => {
        docClient.get(get_params, (err, data) => {
            if (err) {
                console.error("Couldn't get the recipe. Error JSON:", JSON.stringify(err, null, 2));
                return reject(err);
            } else {
                // print all the data
                console.log("Get succeeded. ", JSON.stringify(data));               
                return resolve(data.Item);
            }
        });
    });
}

function getQueriedRecipe(recipeId) {
    const get_params = {
        /*Limit: 2,*/
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
        /*ReturnConsumedCapacity: "TOTAL"*/
    };

    return new Promise((resolve, reject) => {
        docClient.query(get_params, (err, data) => {
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
                        code: 404, // Not Found
                        message: "recipe not found!"
                    });
                }
                return resolve(data.Items[0]);
            }
        });
    });
}

function deleteOldRecipe(partition, sort, id) {
    const deleteParams = {
        TableName: process.env['RECIPE_TABLE'],
        Key: {
            sharedKey: partition,
            lastModifiedDate: sort
        },
        ConditionExpression: "#id = :v_id",
        ExpressionAttributeNames: {
            "#id": "id"
        },
        ExpressionAttributeValues: {
            ":v_id": id
        }
    };

    return new Promise((resolve, reject) => {
        // Call DynamoDB to add the item to the table
        docClient.delete(deleteParams, function(err, data) {
            if (err) {
                console.log("Error recipe DELETE", err);
                return reject(err);
            } 
            else {
                console.log("Success recipe DELETE", data);
                return resolve(data);
            }
        });
    });
}


async function patchRecipe(request, oldRecipe, username, date) {
    for(let value in request) {
        switch(value) {
            case "likes":
                if (request[value] === 'like')
                    oldRecipe.likes += 1;
                if (request[value] === 'unlike')
                oldRecipe.likes -= 1;
                break;
            case "name":
            case "description":
            case "categories":
                oldRecipe[value] = request[value];
                break;
            /* case "description":
                oldRecipe.description = request[value];
                break;
            case "categories":
                oldRecipe.categories = request[value];
                break; */
        }
    }

    console.log('updated recipe: ' + JSON.stringify(oldRecipe));
    await deleteOldRecipe(process.env['SHARED_KEY'], oldRecipe.lastModifiedDate, oldRecipe.id);

    oldRecipe.lastModifiedDate = date;
    
    const putRecipeParams = {
        TableName: process.env['RECIPE_TABLE'],
        Item: oldRecipe
        
    };

    return new Promise((resolve, reject) => {
        // Call DynamoDB to add the item to the table
        docClient.put(putRecipeParams, function(err, data) {
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

//#endregion PATCH recipe Methods

//#region SNS Methods

function getUserFromDB(userId, withFavorites) {
    const params = {
        TableName: process.env['USERS_TABLE'],
        Key: {
            id : userId
        },
        ProjectionExpression: "username, devices"
    };

    if(withFavorites)
        params.ProjectionExpression = "username, devices, favorites";

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
                        code: 404, // Not Found
                        message: "user not found, " + userId
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

/**
 * Trigger notification publisher lambda to notify recipe's uploader about like from any user
 * @param {any} recipe - Recipe that some user did like on
 * @param {string} someUser - Name of user who likes a recipe
 */
async function handlePushNotifications(recipe, someUser) {
    const recipeUploader = await getUserFromDB(recipe.uploader, false);
    if(recipeUploader.devices !== undefined) {
        for(let deviceId in recipeUploader.devices) {
            const subscriptions = recipeUploader.devices[deviceId].subscriptions;
            if(subscriptions !== undefined && 
                subscriptions.likes !== undefined &&
                subscriptions.likes === true) {
                    await invokePublishLambda({
                        "message": recipe.name,
                        "title": someUser + " likes your recipe",
                        "target": recipeUploader.devices[deviceId].endpoint,
                        "id": recipe.id,
                        "channel": "likes"
                    });
            }
        }
    }
}

//#endregion SNS Methods

//#region Update User Details

function updateUserFavorites(userId, favorites) {
    const params = {
        TableName: process.env['USERS_TABLE'],
        Key: {
            id: userId
        },
        UpdateExpression: "SET favorites = :favoritesValue",
        ExpressionAttributeValues: {
            ":favoritesValue": favorites
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
    let id = undefined, lastModifiedDate = undefined, requiredAuth = false;
    let patchAttrs = [];

    //console.log(event['body']);

    try {
        if(event['pathParameters'] && event['pathParameters']['id']) {
            id = event['pathParameters']['id'];
        } else {
            throw {
                code: 400, // Bad Request
                message: "request must contain recipe id"
            };
        }
        if(event['queryStringParameters'] && event['queryStringParameters']['lastModifiedDate']) {
            lastModifiedDate = event['queryStringParameters']['lastModifiedDate'];
        }
    
        const request = JSON.parse(event['body']);

        for(let key in request) {
            if(forbidPatch.includes(key)) {
                throw {
                    code: 400, // Bad Request
                    message: "requested property cannot be changed. " + key
                };
            }
            else{
                if(authPatch.includes(key)) {
                    requiredAuth = true;
                    patchAttrs.push(key);
                }
                else if(freePatch.includes(key)) {
                    patchAttrs.push(key);
                } 
                else { // attribute not exists
                    throw {
                        code: 400, // Bad Request
                        message: "requested property not exists. " + key
                    };
                }
            } 
        }

        let oldRecipe = undefined;
        if(lastModifiedDate !== undefined) {
            oldRecipe = await getRecipe(lastModifiedDate);
        } 
        if(oldRecipe === undefined) {
            oldRecipe = await getQueriedRecipe(id);
        }
        console.log("old recipe, " + oldRecipe);
        if(oldRecipe === undefined) {
            throw {
                code: 404, // Unauthorized
                message: "recipe not found!"
            };
        }
        //let username = 'john doe';
        const { username, sub } = await getUser(event['headers']['Authorization']);

        if(requiredAuth) {
            //authorization check. only the uploader can change some attributes
            //username = await getUsername(event['multiValueHeaders']['Authorization'][0]['AccessToken']);

            if(sub !== oldRecipe.uploader || !admins.includes(sub)) {
                throw {
                    code: 401, // Unauthorized
                    message: "not authorized to change requested attributes!"
                };
            }
        }

        //authorized or doing free patch. either way, a valid request
        const date = dateToString();
        const results = await patchRecipe(request, oldRecipe, username, date);


        console.log('results, ' +  JSON.stringify(results));

        callback(null, setResponse(200, JSON.stringify(await getRecipe(date))));

        if(request['likes'] !== undefined) {//=== 'like' || request['likes'] === 'unlike') {
            // update user favorites record
            let currentUser = await getUserFromDB(sub, true);
            if(currentUser.favorites === undefined || request['likes'] === 'like')
                currentUser.favorites[oldRecipe.id] = oldRecipe.name;
            else
                delete currentUser.favorites[oldRecipe.id];
            await updateUserFavorites(sub, currentUser.favorites);


            if(request['likes'] === 'like') {
                //send push notification to the uploader
                await handlePushNotifications(oldRecipe, username);
            }
        }
    }
    catch(err) {
        //callback(err);
        //callback(null, setResponse(500, err));
        const { code, message } = err;
        if (message !== undefined && code !== undefined) {
            callback(null, setResponse(code, JSON.stringify({"message": message})));
        } else {
            callback(null, setResponse(500, JSON.stringify({"message": err})));
        }
    }

};