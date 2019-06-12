const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});
const documentClient = new AWS.DynamoDB.DocumentClient();


function setResponse(status, body){
    return {
        headers: {
            'Content-Type': 'application/json'},
        body: body,
        statusCode: status
    };
}

function getRecipeComments(key) {
    const params = {
        TableName: process.env['RECIPE_COMMENTS_TABLE'],
        KeyConditionExpression: "recipeId = :v_id",
        ExpressionAttributeValues: {
            ":v_id": key,
        },
        ProjectionExpression: "#date, #message, #user",
        ExpressionAttributeNames: {
            "#date": "creationDate",
            "#message": "message",
            "#user": "user",
        },
    };    

    return new Promise((resolve, reject) => {
        // Call DynamoDB to add the item to the table
        documentClient.query(params, function(err, data) {
            if (err) {
                console.log("Error GET", err);
                return reject(err);
            } 
            else {
                console.log("Success GET", data);
                return resolve(data.Items);
            }
        });
    });
}


exports.handler = async (request, context, callback) => {
    console.log(request);

    try {
        if(request['pathParameters'] && request['pathParameters']['id']) {
            const { id } = request['pathParameters'];
            
            const comments = await getRecipeComments(id);
        
            console.log("response: " + JSON.stringify(comments));
            callback(null, setResponse(200, JSON.stringify(comments)));
        }
        else throw {
            statusCode: 400, // Bad Request
            code: "request must contain recipe id"
        };
    }
    catch(err) {
        const { statusCode, code } = err;
        if (code !== undefined && statusCode !== undefined) {
            callback(null, setResponse(statusCode, JSON.stringify(code)));
        } else {
            callback(null, setResponse(500, JSON.stringify(err)));
            //callback(null, setResponse(500, err));
        }
    }
};