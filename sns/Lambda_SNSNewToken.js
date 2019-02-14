const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});

const docClient = new AWS.DynamoDB.DocumentClient();
const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();
const sns = new AWS.SNS({
    region: process.env['SNS_REGION'],
    apiVersion: '2010-03-31'
});

const platforms = {
    android: "android",
    ios: "ios",
    web: "web",
};

/* const subscriptions = {
    "newRecipe": true,
    "comments": true
};
 */
const model = {
    username: "username",
    confirmed: "confirmed",
    devices: {
        "deviceId": {
            platform: "platform",
            token: "token",
            endpoint: "endpointArn",
            subscriptions: {
                newRecipe: "subscriptionArn",
                comments: true || false,
            }
        }
    },
};


const pathParameters = {
    device: "device",
    token: "token"
};


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

function getUserFromDB(name) {
    const params = {
        TableName: process.env['USERS_TABLE'],
        Key: {
            username : name
        }
    };

    return new Promise((resolve, reject) => {
        docClient.get(params, (err, data) => {
            if (err) {
                console.error("Couldn't get the user. Error JSON:", JSON.stringify(err, null, 2));
                reject(err);
            } else {
                // print all the data
                console.log("Get succeeded. ", JSON.stringify(data));
                if(data.Item === undefined)
                    reject("user not found, " + name);
                resolve(data.Item);
            }
        });
    });
}

function putUser(user) {
    const params = {
        TableName: process.env['USERS_TABLE'],
        Item: user,
        ReturnValues: "ALL_OLD"
    };

    return new Promise((resolve, reject) => {
        docClient.put(params, (err, data) => {
            if(err) {
                console.log("Error user PUT, " + JSON.stringify(err));
                reject(err);
            } else {
                console.log("Success user PUT, " + JSON.stringify(data));
                resolve(data);
            }
        });
    });
}

function subscribeToTopic(topic, endpoint, platform) {
    const params = {
        TopicArn: topic,
        Endpoint: endpoint,
        ReturnSubscriptionArn: true
    };
    switch(platform) {
        case platforms.android:
            params["Protocol"] = "application";
            break;
        default:
            throw "can't subscribe with platform " + platform;
    }

    return new Promise((resolve, reject) => {
        sns.subscribe(params, function(err, data) {
            if(err) {
                console.log("Error subscribing topic, " + JSON.stringify(err));
                console.log(err, err.stack);
                reject(err);
            }
            else {
                console.log("Success subscribing topic, " + JSON.stringify(data));
                resolve(data.SubscriptionArn);
            }
        });
    });
}

function createEndpoint(token, username, platform) {
    let params = {
        Token: token,
        CustomUserData: username
    };
    switch(platform) {
        case platforms.android:
            params['PlatformApplicationArn'] = process.env['ANDROID_APPLICATION_ARN'];
            break;
        default:
            throw "platform " + platform + " is not supported!";
    }

    return new Promise((resolve, reject) => {
        sns.createPlatformEndpoint(params, (err, data) => {
            if (err) {
                console.log("Error create Endpoint, " + err, err.stack);
                reject(err);
            }
            else {
                console.log("Success create Endpoint, " + data);
                resolve(data.EndpointArn);
            }
        });
    });
}

function updateEndpointToken(token, endpoint) {
    var params = {
        Attributes: {
            Token: token
        },
        EndpointArn: endpoint
    };
    return new Promise((resolve, reject) => {
        sns.setEndpointAttributes(params, (err, data) => {
            if (err) {
                console.log("Error update Endpoint, " + err, err.stack);
                reject(err);
            }
            else {
                console.log("Success update Endpoint, " + data);
                resolve(data);
            }
        });
    });
}


exports.handler = async (event, context, callback) => {
    console.log("Received event:", JSON.stringify(event, null, 2));

    try {
        let token = undefined, deviceId = undefined, platform = platforms.android;

        if(event['pathParameters'][pathParameters.token] != undefined && event['pathParameters'][pathParameters.device]) {
            token = event['pathParameters'][pathParameters.token];
            deviceId = event['pathParameters'][pathParameters.device];
        } else {
            throw "request must contain deviceId and token";
        }

        if(event['queryStringParameters'] != undefined && event['queryStringParameters']['platform'] != undefined) {
            platform = event['queryStringParameters']['platform'];
        }

        const username = await getUsername(event['headers']['Authorization']);
        const user = await getUserFromDB(username);

        // the client is in onNewToken()
        
        //first create a devices map attribute if undefined
        if(user.devices === undefined) {
            user.devices = {};
        }
        if(user.devices.deviceId === undefined) {
            user.devices.deviceId = {
                platform: platform,
                token: token,
                endpoint: await createEndpoint(token, username, platform)
            };

            // subscribe to default subscriptions
            user.devices.deviceId.subscriptions = {
                newRecipe: await subscribeToTopic(process.env['NEW_RECIPE_TOPIC_ARN'], user.devices.deviceId.endpoint, platform),
                comments: true
            };
        }
        // change token for existing endpoint
        else {
            await updateEndpointToken(token, user.devices.deviceId.endpoint);
            user.devices.deviceId.token = token;
        }

        if(!user.confirmed)
            user.confirmed = true;
        // save the user record in db
        await putUser(user);

        callback(null);

    } catch(err) {
        console.log(JSON.stringify(err));
        callback(err);
    }    
};