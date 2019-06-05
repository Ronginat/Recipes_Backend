const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});

const docClient = new AWS.DynamoDB.DocumentClient();
const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();

const pathParameters = {
    device: "device"
};

function getUserId(token){
    const params = {
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
                return resolve(data.UserAttributes.find(attr => attr.Name === 'sub').Value);
            }    
        });
    });
}

function getUserFromDB(userId) {
    const params = {
        TableName: process.env['USERS_TABLE'],
        Key: {
            id: userId
        },
        ProjectionExpression: "username, devices, favorites"
    };

    return new Promise((resolve, reject) => {
        docClient.get(params, (err, data) => {
            if (err) {
                console.error("Couldn't get the user. Error JSON:", JSON.stringify(err, null, 2));
                reject(err);
            } else {
                // print all the data
                console.log("Get succeeded. ", JSON.stringify(data));
                resolve(data.Item);
            }
        });
    });
}

exports.handler = async (event, context, callback) => {
    console.log("Received event:", JSON.stringify(event, null, 2));

    try {
        let deviceId = undefined;
        if(event['pathParameters'] !== undefined && event['pathParameters'][pathParameters.device]) {
            deviceId = event['pathParameters'][pathParameters.device];
        } else {
            throw "request must contain deviceId";
        }

        const userId = await getUserId(event['headers']['Authorization']);       

        const user = await getUserFromDB(userId);
        const response = {
            "favorites": Object.keys(user.favorites)
        };

        const devices = user.devices;
        if(devices !== undefined && devices[deviceId] !== undefined) {
            const subscriptions = devices[deviceId].subscriptions;
            subscriptions.newRecipes = subscriptions.newRecipes !== undefined ? true : false;
            subscriptions.appUpdates = subscriptions.appUpdates !== undefined ? true : false;
            response['subscriptions'] = subscriptions;
        }

        callback(null, {
            statusCode: 200,
            body: JSON.stringify(response)
        });

        console.log(JSON.stringify(response));

    } catch(err) {
        console.log("CATCH, " + JSON.stringify(err));
        //callback(err);
        callback(null, { 
            statusCode: 500, 
            body: JSON.stringify({
                "message": err
            })
        });
    }
};