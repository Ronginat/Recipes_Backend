const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});
const docClient = new AWS.DynamoDB.DocumentClient();
const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();
const lambda = new AWS.Lambda({
    region: AWS.config.region,
    apiVersion: '2015-03-31'
});
const admins = ['admin'];
const freePatch = ["likes"];
//const freePatchGetUserName = ["comments"];
const authPatch = ["name", "description", "categories", "html"];
const forbidPatch = ["id", "images", "thumbnail", "createdAt", "partitionKey", "sort", "author", "lastModifiedDate"];


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
                console.log(JSON.stringify(err)); // an error occurred
                return reject(err);
            }
            else {
                console.log(JSON.stringify(data)); // successful response
                return resolve(data.Username);
            }    
        });
    });
}

//#region PATCH recipe Methods

function getRecipe(sortKey) {
    const get_params = {
        TableName: process.env['RECIPE_TABLE'],
        Key: {
            partitionKey: process.env['RECIPES_PARTITION'],
            sort: sortKey // lastModifiedDate
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

function getQueriedRecipe(recipeId, lastModifiedDate) {
    const get_params = {
        Limit: 30,
        TableName: process.env['RECIPE_TABLE'],
        KeyConditionExpression: "partitionKey = :v_key AND #sort >= :v_date",
        FilterExpression: "#id = :v_id",
        ExpressionAttributeNames: {
          "#id":  "id",
          "#sort": "sort"
        },
        ExpressionAttributeValues: {
            ":v_key": process.env['RECIPES_PARTITION'],
            ":v_id": recipeId,
            ":v_date": lastModifiedDate
        },
        ScanIndexForward: false, // read latest first, possible better performance
        // in case the getRecipe didn't work, the recipe probably changed very recently
        ReturnConsumedCapacity: "TOTAL"
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
                        statusCode: 500, // Not Found
                        message: "recipe not found!"
                    });
                }
                return resolve(data.Items[0]);
            }
        });
    });
}

function deleteOldRecipe(lastModified, id) {
    const deleteParams = {
        TableName: process.env['RECIPE_TABLE'],
        Key: {
            partitionKey: process.env['RECIPES_PARTITION'],
            sort: lastModified // lastModifiedDate
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

/**
 * Update recipe content (html string) in recipes table at 'content' partition.
 * @param {string} id id of the recipe
 * @param {string} html new html content
 * @param {string} date updated 'lastModifiedDate' date
 */
function updateContent(recipeId, html, date) {
    const params = {
        TableName: process.env['RECIPE_TABLE'],
        Key: {
            partitionKey: process.env['CONTENT_PARTITION'],
            sort: recipeId
        },
        UpdateExpression: "SET #content = :v_content, #modified = :v_date",
        ExpressionAttributeNames: {
            "#content": "html",
            "#modified": "lastModifiedDate"
        },
        ExpressionAttributeValues: {
            ":v_content": html,
            ":v_date": date
        },
        ReturnValues: "ALL_NEW",
        ReturnConsumedCapacity: "TOTAL"
    };

    return docClient.update(params).promise();
}


async function patchRecipe(request, oldRecipe, username, date) {
    let needToDelete = false;
    for(let value in request) {
        switch(value) {
            case "likes":
                if (request[value] === 'like')
                    oldRecipe.likes += 1;
                if (request[value] === 'unlike')
                oldRecipe.likes -= 1;
                needToDelete = true;
                break;
            case "name":
            case "description":
            case "categories":
                oldRecipe[value] = request[value];
                needToDelete = true;
                break;
            case "html":
                const output = await updateContent(oldRecipe.id, request[value], date);
                console.log('content patch output', JSON.stringify(output));
                break;
            /* case "description":
                oldRecipe.description = request[value];
                break;
            case "categories":
                oldRecipe.categories = request[value];
                break; */
        }
    }

    if (needToDelete) {
        console.log('updated recipe: ' + JSON.stringify(oldRecipe));
        await deleteOldRecipe(oldRecipe.lastModifiedDate, oldRecipe.id);

        oldRecipe.sort = date;
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
    } else {
        return Promise.resolve();
    }
}

//#endregion PATCH recipe Methods

//#region SNS Methods

function getUserFromDB(username, withFavorites) {
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

    if(withFavorites)
        params.ProjectionExpression = "#username, devices, favorites";

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
                        statusCode: 500, // Not Found
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

/**
 * Trigger notification publisher lambda to notify recipe's author about like from any user
 * @param {any} recipe - Recipe that some user did like on
 * @param {string} someUser - Name of user who likes a recipe
 */
async function handlePushNotifications(recipe, someUser) {
    const recipeAuthor = await getUserFromDB(recipe.author, false);
    if(recipeAuthor.devices !== undefined) {
        for(let deviceId in recipeAuthor.devices) {
            const subscriptions = recipeAuthor.devices[deviceId].subscriptions;
            if(subscriptions !== undefined && 
                subscriptions.likes !== undefined &&
                subscriptions.likes === true) {
                    await invokePublishLambda({
                        //"message": recipe.name,
                        "title": recipe.name,// + " likes your recipe",
                        "author": someUser,
                        "target": recipeAuthor.devices[deviceId].endpoint,
                        "id": recipe.id,
                        "channel": "likes"
                    });
            }
        }
    }
}

//#endregion SNS Methods

//#region Update User Details

function updateUserFavorites(username, favorites) {
    const params = {
        TableName: process.env['RECIPE_TABLE'],
        Key: {
            partitionKey: process.env['USERS_PARTITION'],
            sort: username
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
                statusCode: 400, // Bad Request
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
                    statusCode: 400, // Bad Request
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
                        statusCode: 400, // Bad Request
                        message: "requested property not exists. " + key
                    };
                }
            } 
        }

        let oldRecipe = undefined;
        if(lastModifiedDate) {
            oldRecipe = await getRecipe(lastModifiedDate);
        } 
        if(!oldRecipe) {
            oldRecipe = await getQueriedRecipe(id, lastModifiedDate);
        }
        console.log("old recipe, " + JSON.stringify(oldRecipe));
        if(!oldRecipe) {
            throw {
                statusCode: 500, // Internal Server Error
                message: "recipe not found!"
            };
        }
        //let username = 'john doe';
        const username = await getUser(event['headers']['Authorization']);

        if(requiredAuth) {
            //authorization check. only the author can change some attributes
            //username = await getUsername(event['multiValueHeaders']['Authorization'][0]['AccessToken']);

            if(username !== oldRecipe.author && !admins.includes(username)) {
                throw {
                    statusCode: 500, // Unauthorized
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
            let currentUser = await getUserFromDB(username, true);
            if(currentUser.favorites === undefined || request['likes'] === 'like')
                currentUser.favorites[oldRecipe.id] = oldRecipe.name;
            else
                delete currentUser.favorites[oldRecipe.id];
            await updateUserFavorites(username, currentUser.favorites);


            if(request['likes'] === 'like') {
                //send push notification to the author
                await handlePushNotifications(oldRecipe, username);
            }
        }
    }
    catch(err) {
        console.log('err', JSON.stringify(err));
        //callback(err);
        //callback(null, setResponse(500, err));
        /* const { code, message } = err;
        if (message !== undefined && code !== undefined) {
            callback(null, setResponse(code, JSON.stringify({"message": message})));
        } else {
            callback(null, setResponse(500, JSON.stringify({"message": err})));
        } */
        callback(null, setResponse(
            err.statusCode && err.statusCode === 400 ? 400 : 500, 
            JSON.stringify(err.message ? err.message : err))
        );
    }
};