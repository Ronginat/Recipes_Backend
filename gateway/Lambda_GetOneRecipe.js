const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});
const docClient = new AWS.DynamoDB.DocumentClient();

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


exports.handler = async function(event, context, callback) {
    let id = undefined, lastModifiedDate = undefined;
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
        
        let recipe = undefined;
        if(lastModifiedDate !== undefined) {
            recipe = await getRecipe(lastModifiedDate);
        } else {
            recipe = await getQueriedRecipe(id);
        }
        
        callback(null, setResponse(200 , JSON.stringify(recipe)));
    }
    catch(err) {
        //callback(err);
        //callback(null, setResponse(500, err));
        callback(null, setErrorResponse(500, JSON.stringify({"message": err})));
    }

};