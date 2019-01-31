const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});
const docClient = new AWS.DynamoDB.DocumentClient();
const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();

const freePatch = ["likes"];
const freePatchGetUserName = ["comments"];
const authPatch = ["description", "categories"];
const forbidPatch = ["id", "name", "recipeFile", "foodFiles", "createdAt", "sharedKey", "uploader", "lastModifiedDate"];


function setResponse(status/* , body */){
    let response = {
        headers: {
            'Content-Type': 'application/json'},
        /* body: body, */
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
    const date = new Date();
    var day = date.getUTCDate();
    var month = date.getUTCMonth() + 1;
    var year = date.getUTCFullYear();

    const hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    const seconds = date.getUTCSeconds();
    const millis = date.getUTCMilliseconds();

    return '' + year + '-' + (month <= 9 ? '0' + month : month) + '-' + (day <= 9 ? '0' + day : day)
            + ' ' + (hours <= 9 ? '0' + hours : hours) + ':' + (minutes <= 9 ? '0' + minutes : minutes)
            + ':' + (seconds <= 9 ? '0' + seconds : seconds)
            + '.' + (millis <= 10 ? '00' + millis : ( millis <= 100 ? '0' + millis : millis) );
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
            case "comments":
                await postComment(oldRecipe.id, request[value], username, date);
                break;
            case "description":
                oldRecipe.description = request[value];
                needToDelete = true;
                break;
            case "categories":
                oldRecipe.categories = request[value];
                needToDelete = true;
                break;
        }
    }

    if(needToDelete) {
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
    } else {
        return new Promise(resolve => resolve());
    }
}


exports.handler = async function(event, context, callback) {
    let id = undefined, lastModifiedDate = undefined, requiredAuth = false, requiredUserName = false;
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
                else if(freePatchGetUserName.includes(key)) {
                    requiredUserName = true;
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
        } else {
            oldRecipe = await getQueriedRecipe(id);
        }
        console.log("old recipe, " + oldRecipe);
        if(oldRecipe == null || oldRecipe == undefined) {
            throw "recipe not found!";
        }
        let username = 'john doe';

        if(requiredAuth || requiredUserName)
            username = await getUsername(event['multiValueHeaders']['Authorization'][0]['AccessToken']);

        if(requiredAuth) {
            //authorization check. only the uploader can change some attributes
            //username = await getUsername(event['multiValueHeaders']['Authorization'][0]['AccessToken']);
            const uploader = oldRecipe.uploader;

            if(username !== uploader) {
                throw "not authorized to change requested attributes!";
            }
        }

        //authorized or doing free patch. either way, a valid request
        const results = await patchRecipe(request, oldRecipe, username, dateToString());

        console.log('results, ' +  JSON.stringify(results));

        callback(null, setResponse(200/* , JSON.stringify(results) */));
    }
    catch(err) {
        //callback(err);
        //callback(null, setResponse(500, err));
        callback(null, setErrorResponse(500, JSON.stringify({"message": err})));
    }

};



/* function getUploader(key) {
    let params = {
        "TableName": process.env['RECIPE_TABLE'],
        "Key": {
            "id": key,
            "sharedKey": process.env['SHARED_KEY']
        },
        "ProjectionExpression": "uploader"
    };

    return new Promise((resolve, reject) => {
        // Call DynamoDB to add the item to the table
        documentClient.get(params, function(err, data) {
            if (err) {
                console.log("Error GET", err);
                return reject(err);
            } 
            else {
                if(data['Item'] == undefined) {
                    reject("item not found in recipes table");
                }
                else {
                    console.log("Success GET", data);
                    return resolve(data['Item']['uploader']['S']);
                }
            }
        });
    });
} */

/* function updateItemInRecipes(id, attributes) {
    let expression = generateExpressionAttributes(attributes);

    let params = {
        TableName: process.env['RECIPE_TABLE'],
        Key: {
            'id' : id,
            'sharedKey': process.env['SHARED_KEY'],
        },
        UpdateExpression : expression.Updates,
        ExpressionAttributeValues : expression.Values,
        ReturnValues: "ALL_NEW"
    };

    return new Promise((resolve, reject) => {
        // Call DynamoDB to add the item to the table
        documentClient.update(params, function(err, data) {
            if (err) {
                console.log("Error recipe UPDATE", JSON.stringify(err, null, 2));
                return reject(err);
            } 
            else {
                console.log("Success recipe UPDATE", JSON.stringify(data));
                return resolve(data['Attributes']);
            }
        });
    });
}

function generateExpressionAttributes(recipe, attributes) {
    //let date = moment.tz("Asia/Jerusalem").format('YYYY-MM-DD HH:mm:ss');
    let date = dateToString();
    let Updates = "SET ";
    let Values = {};

    for(let value in attributes) {
        switch(value) {
            case "likes":
                Updates = Updates.concat("likes = likes + :likeValue, ");
                if (attributes[value] === 'like')
                    Values[':likeValue'] = 1;
                if (attributes[value] === 'unlike')
                    Values[':likeValue'] = -1;
                break;
            case "comments":
                Updates = Updates.concat("SET comments = list_append(comments, :commValue), ");
                let comment = attributes[value];
                comment['date'] = date;
                Values[':commValue'] = [comment];
                break;
            case "description":
                Updates = Updates.concat("description = :descValue, ");
                Values[':descValue'] = attributes[value];
                break;
            case "categories":
                Updates = Updates.concat("categories = :catValue, ");
                Values[':catValue'] = attributes[value];
                break;
        }
    }

    Updates = Updates.concat("lastModifiedDate = :dateValue");
    Values[':dateValue'] = date;

    return {
        "Updates": Updates,
        "Values": Values
    };
} */