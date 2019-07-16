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
 * @param {string} recipeId - the recipe's id
 * @returns {Promise<string>} content of the recipe
 */
function getRecipeContent(recipeId) {
    const params = {
        TableName: process.env['RECIPE_TABLE'],
        Key: {
            partitionKey: process.env['CONTENT_PARTITION'],
            sort: recipeId // recipe id
        },
        ProjectionExpression: "#id, #name, #date, #html",
        ExpressionAttributeNames: {
            "#id": "id",
            "#name": "name",
            "#date": "lastModifiedDate",
            "#html":  "html"
        }
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
                        statusCode: 404, // Not Found
                        message: "recipe content not found"
                    });
                }
                return resolve(data.Item);
            }
        });
    });
}

exports.handler = async function(event, context, callback) {
    //console.log(JSON.stringify(event.body));

    try {
        if (event['pathParameters'] && event['pathParameters']['id']) {
            const { id } = event['pathParameters'];
            const { lastModifiedDate } = event['queryStringParameters'] ? event['queryStringParameters'] : undefined;
            const content = await getRecipeContent(id);
            if (lastModifiedDate) {
                if (content.lastModifiedDate > lastModifiedDate) {
                    // new content available
                    callback(null, setResponse(200 , JSON.stringify(content)));
                } else {
                    // content not modified
                    callback(null, setResponse(304 , ''));
                }
            } else {
                // recipe without html content will return null object
                // return the html content represented as string
                callback(null, setResponse(200 , JSON.stringify(content)));
            }
        } else {
            throw {
                statusCode: 400, // Bad Request
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
        /* const { statusCode, message } = err;
        if (message && statusCode) {
            callback(null, setResponse(statusCode, JSON.stringify(message)));
        } else {
            callback(null, setResponse(500, JSON.stringify(err)));
        } */
        callback(null, setResponse(
            err.statusCode && !err.code ? err.statusCode : 500, // err.code thrown by external aws libraries
            JSON.stringify(err.message ? err.message : err))
        );
    }
};