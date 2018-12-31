const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});
//const ddb = new AWS.DynamoDB({apiVersion: '2012-10-08'});
const documentClient = new AWS.DynamoDB.DocumentClient();


function setResponse(status, body){
    let response = {
        headers: {
            'Content-Type': 'application/json'},
        body: body,
        statusCode: status
    };
      
    return response;
}


function getRecipe(key) {
    let params = {
        "TableName": process.env['RECIPE_TABLE'],
        "Key": {
            "id": key,
            "sharedKey": process.env['SHARED_KEY']
        },
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
                    return resolve(data['Item']);
                }
            }
        });
    });
}


exports.handler = async function(request, context, callback) {
    console.log(request);

    try {
        if(request['pathParameters'] != undefined && request['pathParameters']['id'] != undefined) {
            const id = request['pathParameters']['id'];
            
            let item = await getRecipe(id);
        
            console.log("response: " + JSON.stringify(item));
            callback(null, setResponse(200, JSON.stringify(item)));
        } 
            else throw "must send recipe id!";
    }
    catch(err) {
        callback(null, setResponse(400, err));
    }

};