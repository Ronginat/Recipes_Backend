const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});
const docClient = new AWS.DynamoDB.DocumentClient();

function setResponse(status, body){
    return {
        headers: {
            'Content-Type': 'application/json'},
        body: body,
        statusCode: status
    };
}

/**
 * 
 * @param {string} sortKey - lastModified
 * @returns {Promise<string>} content of the recipe
 */
function getRecipeContent(sortKey) {
    const get_params = {
        TableName: process.env['RECIPE_TABLE'],
        Key: {
            "sharedKey": process.env['SHARED_KEY'],
            "lastModifiedDate": sortKey
        },
        ProjectionExpression: "#html",
        ExpressionAttributeNames: {
            "#html":  "html"
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
                if (data.Item === undefined) {
                    return resolve(data.Item)
                }
                return resolve(data.Item.html);
            }
        });
    });
}

function getQueriedRecipeContent(recipeId) {
    const get_params = {
        /*Limit: 2,*/
        TableName: process.env['RECIPE_TABLE'],
        KeyConditionExpression: "sharedKey = :v_key",
        FilterExpression: "#id = :v_id",
        ProjectionExpression: "#html",
        ExpressionAttributeNames: {
          "#id":  "id",
          "#html":  "html"
        },
        ExpressionAttributeValues: {
            ":v_key": process.env['SHARED_KEY'],
            ":v_id": recipeId
        }
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
                if(/* data.Count === 0 ||  */data.Items.length === 0) {
                    return reject({
                        status: 404, // Not Found
                        message: "recipe not found"
                    });
                }
                return resolve(data.Items[0].html);
            }
        });
    });
}


exports.handler = async function(event, context, callback) {
    let id = undefined, lastModifiedDate = undefined;
    //console.log(event['body']);

    try {
        if (event['pathParameters'] !== undefined && event['pathParameters']['id'] !== undefined) {
            id = event['pathParameters']['id'];
        } else {
            throw {
                status: 400, // Bad Request
                message: "request must contain recipe id"
            };
        }
        if (event['queryStringParameters'] !== undefined && event['queryStringParameters']['lastModifiedDate'] !== undefined) {
            lastModifiedDate = event['queryStringParameters']['lastModifiedDate'];
        }
        
        let content = undefined;
        if (lastModifiedDate !== undefined) {
            content = await getRecipeContent(lastModifiedDate);
        } 
        if (content === undefined) {
            content = await getQueriedRecipeContent(id);
        }

        // recipe without html content will return null object
        // return the html content represented as string
        callback(null, setResponse(200 , content));
    }
    catch(err) {
        //callback(err);
        //callback(null, setResponse(500, err));
        const { status, message } = err;
        if (message !== undefined && status !== undefined) {
            callback(null, setResponse(status, JSON.stringify({"message": message})));
        } else {
            callback(null, setResponse(500, JSON.stringify({"message": err})));
        }
    }
};