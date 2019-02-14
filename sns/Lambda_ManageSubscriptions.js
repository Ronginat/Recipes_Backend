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

const subscription = {
    subscribe: "subscribe",
    unsubscribe: "unsubscribe",
    changePolicy: "changePolicy"
};

/* const subscriptions = {
    recipe: "newRecipe",
    comment: "comments"
}; */

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
    device: "device"
};

const queryStringParameters = {
    recipeSubscription: "newRecipe",
    commentSubscription: "comments"
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

function subscribeToTopic(topic, endpoint, filterPolicy, platform) {
    const params = {
        /* Protocol: "application", */
        TopicArn: topic,
        /* Attributes: {
          FilterPolicy: filterPolicy,
        }, */
        Endpoint: endpoint,
        ReturnSubscriptionArn: true
      };

      if(platform === platforms.android) {
          params.Protocol = "application";
      }
      if(filterPolicy !== undefined) {
          params.Attributes = {
              FilterPolicy: filterPolicy
          };
      }
      return new Promise((resolve, reject) => {
        sns.subscribe(params, (err, data) => {
            if (err) {
                console.log("Error subscribe, " + err, err.stack);
                reject(err);
            }
            else {
                console.log("Success subscribe, " + data);
                resolve(data.SubscriptionArn);
            }
        });
    });
}

function unsubscribeToTopic(subscriptionArn) {
    const params = {
        SubscriptionArn: subscriptionArn
    };

    return new Promise((resolve, reject) => {
        sns.unsubscribe(params, (err, data) => {
            if (err) {
                console.log("Error unsubscribe, " + err, err.stack);
                reject(err);
            }
            else {
                console.log("Success unsubscribe, " + data);
                resolve(data);
            }
        });
    });    
}

function setSubscriptionAttributes(subscriptionArn, filterPolicy) {
    const params = {
        AttributeName: "FilterPolicy",
        SubscriptionArn: subscriptionArn,
        AttributeValue: filterPolicy
    };

    return new Promise((resolve, reject) => {
        sns.setSubscriptionAttributes(params, (err, data) => {
            if (err) {
                console.log("Error setSubscriptionAttributes, " + err, err.stack);
                reject(err);
            }
            else {
                console.log("Success setSubscriptionAttributes, " + data);
                resolve(data);
            }
        });
    });    
}


exports.handler = async (event, context, callback) => {
    console.log("Received event:", JSON.stringify(event, null, 2));
    
    try {
        const request = JSON.parse(event['body']);
        let deviceId = undefined;
        let recipeFlag = undefined, commentFlag = undefined, recipePolicy = undefined;

        if(event['pathParameters'] != undefined && event['pathParameters'][pathParameters.device]) {
            deviceId = event['pathParameters'][pathParameters.device];
        } else {
            throw "request must contain deviceId";
        }
        if(event['queryStringParameters'] != undefined) {
            if(event['queryStringParameters'][queryStringParameters.recipeSubscription] != undefined) {
                recipeFlag = event['queryStringParameters'][queryStringParameters.recipeSubscription];
                recipePolicy = JSON.parse(request[queryStringParameters.recipeSubscription]);
            }
            if(event['queryStringParameters'][queryStringParameters.commentSubscription] != undefined) {
                commentFlag = event['queryStringParameters'][queryStringParameters.commentSubscription];
            }
        }
        else
            throw "No subscription provided";
        const username = await getUsername(event['headers']['Authorization']);       

        const user = await getUserFromDB(username);
 
        if(user.devices === undefined || user.devices.deviceId === undefined) {
            throw "Device not registered!";
        }
        const deviceAttributes = user.devices.deviceId;

        //#region Subscriptions

        // flag meaning that the client wants
        if(recipeFlag !== undefined) {
            switch(recipeFlag) {
                case subscription.subscribe:
                    if(deviceAttributes.subscriptions.newRecipe === undefined) {
                        deviceAttributes.subscriptions.newRecipe = 
                            await subscribeToTopic(process.env['NEW_RECIPE_TOPIC_ARN'], deviceAttributes.endpoint, recipePolicy, deviceAttributes.platform);
                    }
                    break;
                case subscription.unsubscribe:
                    if(deviceAttributes.subscriptions.newRecipe !== undefined) {
                        await unsubscribeToTopic(deviceAttributes.subscriptions.newRecipe);
                        deviceAttributes.subscriptions.newRecipe = undefined;
                    }
                    break;

                case subscription.changePolicy:
                    if(deviceAttributes.subscriptions.newRecipe !== undefined
                            && recipePolicy !== undefined) {
                        await setSubscriptionAttributes(deviceAttributes.subscriptions.newRecipe, recipePolicy);
                    }
                    break;
                default:
                    throw "Specify what to do with new recipe subscription!"
            }
        }
        
        if(commentFlag !== undefined) {
            switch(commentFlag) {
                case subscription.subscribe:
                    deviceAttributes.subscriptions.comments = true;
                    break;
                case subscription.unsubscribe:
                    deviceAttributes.subscriptions.comments = false;
                    break;
                default:
                    throw "Specify what to do with comments subscription!"
            }
        }

        user.devices.deviceId = deviceAttributes;
        await putUser(user);

        //#endregion Subscriptions


    } catch(err) {
        console.log("CATCH, " + JSON.stringify(err));
        callback(err);
    }
};