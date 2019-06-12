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
 * @param {string} sortKey - { name: lastModified, value: the recipe id }
 * @returns {Promise<string>} content of the recipe
 */
function getRecipeContent(sortKey) {
    const params = {
        TableName: process.env['RECIPE_TABLE'],
        Key: {
            "sharedKey": process.env['CONTENT_KEY'],
            "lastModifiedDate": sortKey
        }
        /* ProjectionExpression: "#html",
        ExpressionAttributeNames: {
            "#html":  "html"
        } */
    };

    return new Promise((resolve, reject) => {
        docClient.get(params, (err, data) => {
            if (err) {
                console.error("Couldn't get the recipe. Error JSON:", JSON.stringify(err, null, 2));
                return reject(err.code);
            } else {
                // print all the data
                console.log("Get succeeded. ", JSON.stringify(data));
                if (data.Item === undefined) {
                    return reject({
                        status: 404, // Not Found
                        message: "recipe content not found"
                    });
                }
                return resolve(data.Item.html);
            }
        });
    });
}

exports.handler = async function(event, context, callback) {
    //let id = undefined, lastModifiedDate = undefined;
    //console.log(event['body']);

    try {
        if (event['pathParameters'] && event['pathParameters']['id']) {
            const { id } = event['pathParameters'];
            const content = await getRecipeContent(id); 
    
            // recipe without html content will return null object
            // return the html content represented as string
            callback(null, setResponse(200 , content));
        } else {
            throw {
                status: 400, // Bad Request
                message: "request must contain recipe id"
            };
        }
        /* if (event['queryStringParameters'] !== undefined && event['queryStringParameters']['lastModifiedDate'] !== undefined) {
            lastModifiedDate = event['queryStringParameters']['lastModifiedDate'];
        } */
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