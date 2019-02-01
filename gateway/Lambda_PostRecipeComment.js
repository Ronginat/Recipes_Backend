const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});
const docClient = new AWS.DynamoDB.DocumentClient();
const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();


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

/* function getRecipe(sortKey) {
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
        //ReturnConsumedCapacity: "TOTAL"
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
 */

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


exports.handler = async function(event, context, callback) {
    let id = undefined;//, lastModifiedDate = undefined;

    //console.log(event['body']);

    try {
        if(event['pathParameters'] != undefined && event['pathParameters']['id'] != undefined) {
            id = event['pathParameters']['id'];
        } else {
            throw "request must contain recipe id";
        }
        /* if(event['queryStringParameters'] != undefined && event['queryStringParameters']['lastModifiedDate'] != undefined) {
            lastModifiedDate = event['queryStringParameters']['lastModifiedDate'];
        } */
        
    
        const request = JSON.parse(event['body']);

       /*  let oldRecipe = undefined;
        if(lastModifiedDate !== undefined) {
            oldRecipe = await getRecipe(lastModifiedDate);
        } else {
            oldRecipe = await getQueriedRecipe(id);
        }
        console.log("old recipe, " + oldRecipe);
        if(oldRecipe == null || oldRecipe == undefined) {
            throw "recipe not found!";
        } */
        const username = await getUsername(event['headers']['Authorization']);

        await postComment(id, request['comment'], username, dateToString());

        //const results = await patchRecipe(request, oldRecipe, username, dateToString());

        //console.log('results, ' +  JSON.stringify(results));

        callback(null, setResponse(200/* , JSON.stringify(results) */));
    }
    catch(err) {
        //callback(err);
        //callback(null, setResponse(500, err));
        callback(null, setErrorResponse(500, JSON.stringify({"message": err})));
    }

};