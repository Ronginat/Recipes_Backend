const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});

const docClient = new AWS.DynamoDB.DocumentClient();
const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();
const sns = new AWS.SNS({
    region: process.env['SNS_REGION'],
    apiVersion: '2010-03-31'
});

/* const admin = require('firebase-admin');

const serviceAccount = require('./serviceAccount.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
}); */

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
                likes: true || false
            }
        }
    },
};


const pathParameters = {
    device: "device",
    token: "token"
};

function setResponse(status, body){
    return {
        headers: {
            'Content-Type': 'application/json'},
        body: body,
        statusCode: status
    };
}

function getUser(token){
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
                return resolve(data.Username);
            }    
        });
    });
}

function getUserFromDB(username) {
    const params = {
        TableName: process.env['RECIPES_TABLE'],
        Key: {
            partitionKey: process.env['USERS_PARTITION'],
            sort : username
        },
        ProjectionExpression: "#username, devices, confirmed",
        ExpressionAttributeNames: {
            "#username": "sort"
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
                resolve(data.Item);
            }
        });
    });
}

/*
 * register the user in firebase database (firestore) as document 
 * with key of userId and value as username
 * @param {string} userId - document key
 * @param {string} username - docmuent value
 */
/* function documentUserInFirestore(userId, username) {
    const firestore = admin.firestore();
    return firestore.collection('users').doc(userId).set({
        username: username
    }, {
        merge: true
    });
} */

function updateUser(user) {
    const params = {
        TableName: process.env['RECIPES_TABLE'],
        Key: {
            partitionKey: process.env['USERS_PARTITION'], //user
            sort: user.sort
        },
        UpdateExpression: "SET devices = :devicesValue, confirmed = :confirmedValue",
        ExpressionAttributeValues: {
            ":devicesValue": user.devices,
            ":confirmedValue": user.confirmed
        },
        ReturnValues: "ALL_OLD"
    };

    return new Promise((resolve, reject) => {
        docClient.update(params, (err, data) => {
            if(err) {
                console.log("Error user UPDATE", JSON.stringify(err, null, 2));
                reject(err);
            } else {
                console.log("Success user UPDATE", JSON.stringify(data));
                resolve(data.Attributes);
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
            throw {
                statusCode: 500, // Internal Server Error
                message: "can't subscribe with platform " + platform
            };
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
    const params = {
        Token: token,
        CustomUserData: username
    };
    switch(platform) {
        case platforms.android:
            params['PlatformApplicationArn'] = process.env['ANDROID_APPLICATION_ARN'];
            break;
        default:
            throw {
                statusCode: 500, // Internal Server Error
                message: "platform " + platform + " is not supported!"
            };
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
    const params = {
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
        let token = undefined, deviceId = undefined, platform = platforms.android, version = undefined, appVersion= undefined;

        if(event['pathParameters'][pathParameters.token] && event['pathParameters'][pathParameters.device]) {
            token = event['pathParameters'][pathParameters.token];
            deviceId = event['pathParameters'][pathParameters.device];
        } else {
            throw {
                statusCode: 400, // Bad Request
                message: "request must contain deviceId and token"
            };
        }

        if(event['queryStringParameters']) {
            if (event['queryStringParameters']['platform']) {
                platform = event['queryStringParameters']['platform'];
            }
            if(event['queryStringParameters']['version']) {
                version = event['queryStringParameters']['version'];
            }
            if(event['queryStringParameters']['app_version']) {
                appVersion = event['queryStringParameters']['app_version'];
            }
        }

        const username = await getUser(event['headers']['Authorization']);
        const user = await getUserFromDB(username);
        if (!user) {
            throw {
                statusCode: 500, // Internal Server Error
                message: "User not found"
            };
        }

        // the client is in onNewToken()
        
        // first create a devices map attribute if undefined
        if(user.devices === undefined) {
            user.devices = {};
        }
        if(user.devices[deviceId] === undefined) {
            user.devices[deviceId] = {
                platform: platform,
                version: version,
                appVersion: appVersion,
                token: token,
                endpoint: await createEndpoint(token, username, platform)
            };

            const [newRecipesSubscriber, appUpdatesSubscriber] = await Promise.all([
                subscribeToTopic(process.env['NEW_RECIPE_TOPIC_ARN'], user.devices[deviceId].endpoint, platform),
                subscribeToTopic(process.env['APP_UPDATES_TOPIC_ARN'], user.devices[deviceId].endpoint, platform)
            ]);

            // subscribe to default subscriptions - topics and comments
            user.devices[deviceId].subscriptions = {
                //newRecipes: await subscribeToTopic(process.env['NEW_RECIPE_TOPIC_ARN'], user.devices[deviceId].endpoint, platform),
                newRecipes: newRecipesSubscriber,
                comments: true,
                likes: false,
                appUpdates: appUpdatesSubscriber
            };
        }
        // change token for existing endpoint
        else {
            await updateEndpointToken(token, user.devices[deviceId].endpoint);
            user.devices[deviceId].token = token;
        }

        if(!user.confirmed)
            user.confirmed = true;
        // save the user record in db
        await updateUser(user);

        callback(null, {
            statusCode: 200
        });

    } catch(err) {
        console.log(JSON.stringify(err));
        //callback(err);
        callback(null, setErrorResponse(
            err.statusCode && err.statusCode === 400 ? 400 : 500, 
            JSON.stringify(err.message ? err.message : err))
        );
        /* const { statusCode, message } = err;
        if (message !== undefined && statusCode !== undefined) {
            callback(null, setResponse(statusCode, JSON.stringify(message)));
        } else {
            callback(null, setResponse(500, JSON.stringify(err)));
        } */
    }    
};