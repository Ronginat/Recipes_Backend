const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});
const docClient = new AWS.DynamoDB.DocumentClient();
const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();
const lambda = new AWS.Lambda({
    region: AWS.config.region,
    apiVersion: '2015-03-31'
});

const freePatch = ["likes"];
//const freePatchGetUserName = ["comments"];
const authPatch = ["description", "categories"];
const forbidPatch = ["id", "name", "recipeFile", "foodFiles", "createdAt", "sharedKey", "uploader", "lastModifiedDate"];


function setResponse(status, body){
    let response = {
        headers: {
            'Content-Type': 'application/json'},
        body: body,
        statusCode: status
    };
      
    return response;
}

function setErrorResponse(status, err){
    let response = {
        headers: {
            'Content-Type': 'application/json'},
        body: err,
        statusCode: status
    };
      
    return response;
}

function dateToString() {
    return new Date().toISOString();
}

function getUsername(token){
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
                if(data.Item === undefined)
                    return resolve(null);
                    //return reject("recipe not found");
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
                    return reject("recipe not found");
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
            case "description":
                oldRecipe.description = request[value];
                break;
            case "categories":
                oldRecipe.categories = request[value];
                break;
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

function getUserFromDB(name, withFavorites) {
    const params = {
        TableName: process.env['USERS_TABLE'],
        Key: {
            "hash": process.env['APP_NAME'], //Recipes
            "username" : name
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
                    reject("user not found, " + name);
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

async function handlePushNotifications(recipe, someUser) {
    //const recipe = await getQueriedRecipe(id);
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

function updateUserFavorites(username, favorites) {
    const params = {
        TableName: process.env['USERS_TABLE'],
        Key: {
            hash: process.env['APP_NAME'], //Recipes
            username: username
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

exports.handler = async function(event, context, callback) {
    let id = undefined, lastModifiedDate = undefined, requiredAuth = false;
    let patchAttrs = [];

    //console.log(event['body']);

    try {
        if(event['pathParameters'] != undefined && event['pathParameters']['id'] != undefined) {
            id = event['pathParameters']['id'];
        } else {
            throw "request must contain recipe id";
        }
        if(event['queryStringParameters'] != undefined && event['queryStringParameters']['lastModifiedDate'] != undefined) {
            lastModifiedDate = event['queryStringParameters']['lastModifiedDate'];
        }
        
    
        const request = JSON.parse(event['body']);

        for(let key in request) {
            if(forbidPatch.includes(key)) {
                throw "requested property cannot be patched. " + key;
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
                    throw "requested property not exists. " + key;
                }
            } 
        }

        let oldRecipe = undefined;
        if(lastModifiedDate !== undefined) {
            oldRecipe = await getRecipe(lastModifiedDate);
        } 
        if(lastModifiedDate === undefined || oldRecipe === undefined || oldRecipe === null) {
            oldRecipe = await getQueriedRecipe(id);
        }
        console.log("old recipe, " + oldRecipe);
        if(oldRecipe == null || oldRecipe == undefined) {
            throw "recipe not found!";
        }
        //let username = 'john doe';
        const username = await getUsername(event['headers']['Authorization']);//[0]['AccessToken']);

        if(requiredAuth) {
            //authorization check. only the uploader can change some attributes
            //username = await getUsername(event['multiValueHeaders']['Authorization'][0]['AccessToken']);

            if(username !== oldRecipe.uploader) {
                throw "not authorized to change requested attributes!";
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
                //send push notification to the uploader
                await handlePushNotifications(oldRecipe, username);
            }
        }
    }
    catch(err) {
        //callback(err);
        //callback(null, setResponse(500, err));
        callback(null, setErrorResponse(500, JSON.stringify({"message": err})));
    }

};