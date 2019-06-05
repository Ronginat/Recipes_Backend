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
                return resolve(data['Items']);
            }
        });
    });
}


exports.handler = async (request, context, callback) => {
    console.log(request);

    try {
        if(request['pathParameters'] !== undefined && request['pathParameters']['id'] !== undefined) {
            const id = request['pathParameters']['id'];
            
            //let item = await getRecipe(id);
            const comments = await getRecipeComments(id);
        
            console.log("response: " + JSON.stringify(comments));
            callback(null, setResponse(200, JSON.stringify(comments)));
        } 
            else throw {
                code: 400, // Bad Request
                message: "request must contain recipe id"
            };
    }
    catch(err) {
        const { code, message } = err;
        if (message !== undefined && code !== undefined) {
            callback(null, setResponse(code, JSON.stringify({"message": message})));
        } else {
            callback(null, setResponse(500, JSON.stringify({"message": err})));
            //callback(null, setResponse(500, err));
        }
    }
};