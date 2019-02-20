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
    comment: "comments",
    like: "likes"
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
                newRecipes: "subscriptionArn",
                comments: true || false,
                likes: true || false,
            }
        }
    },
    favorites: {}
};

const pathParameters = {
    device: "device"
};

const queryStringParameters = {
    recipeSubscription: "newRecipes",
    commentSubscription: "comments",
    likeSubscription: "likes"
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

// get specific attributes from db - username(string), devices(map), confirmed(string)
function getUserFromDB(name) {
    const params = {
        TableName: process.env['USERS_TABLE'],
        Key: {
            hash: process.env['APP_NAME'], //Recipes
            username : name
        },
        ProjectionExpression: "username, devices, confirmed"
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

// update(using SET) only devices(map) attribute in db
function updateUser(user) {
    const params = {
        TableName: process.env['USERS_TABLE'],
        Key: {
            hash: process.env['APP_NAME'], //Recipes
            username: user.username
        },
        UpdateExpression: "SET devices = :devicesValue",
        ExpressionAttributeValues: {
            ":devicesValue": user.devices
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

/* function putUser(user) {
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
} */

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
        let recipeFlag = undefined, commentFlag = undefined, likeFlag = undefined, recipePolicy = undefined;

        //Retreive Path Parameter
        if(event['pathParameters'] != undefined && event['pathParameters'][pathParameters.device]) {
            deviceId = event['pathParameters'][pathParameters.device];
        } else {
            throw "request must contain deviceId";
        }
        //Retreive Query Parameters
        if(event['queryStringParameters'] != undefined) {
            if(event['queryStringParameters'][queryStringParameters.recipeSubscription] != undefined) {
                recipeFlag = event['queryStringParameters'][queryStringParameters.recipeSubscription];
                if(request[queryStringParameters.recipeSubscription] !== undefined)
                    recipePolicy = JSON.parse(request[queryStringParameters.recipeSubscription]);
            }
            if(event['queryStringParameters'][queryStringParameters.commentSubscription] != undefined) {
                commentFlag = event['queryStringParameters'][queryStringParameters.commentSubscription];
            }
            if(event['queryStringParameters'][queryStringParameters.likeSubscription] != undefined) {
                likeFlag = event['queryStringParameters'][queryStringParameters.likeSubscription];
            }
        }
        else
            throw "No subscription provided";
        //Retreive user record from db
        const username = await getUsername(event['headers']['Authorization']);      

        const user = await getUserFromDB(username);
 
        if(user.devices === undefined || user.devices[deviceId] === undefined) {
            throw "Device not registered!";
        }
        //Shortcut reference to current device object
        const deviceAttributes = user.devices[deviceId];

        //#region Subscriptions

        // each flag means that the client wants to change the relevant subscription
        if(recipeFlag !== undefined) {
            switch(recipeFlag) {
                case subscription.subscribe:
                    if(deviceAttributes.subscriptions.newRecipes === undefined) {
                        deviceAttributes.subscriptions.newRecipes = 
                            await subscribeToTopic(process.env['NEW_RECIPE_TOPIC_ARN'], deviceAttributes.endpoint, recipePolicy, deviceAttributes.platform);
                    }
                    break;
                case subscription.unsubscribe:
                    if(deviceAttributes.subscriptions.newRecipes !== undefined) {
                        await unsubscribeToTopic(deviceAttributes.subscriptions.newRecipes);
                        deviceAttributes.subscriptions.newRecipes = undefined;
                    }
                    break;
                //currently not supported by the client
                case subscription.changePolicy:
                    if(deviceAttributes.subscriptions.newRecipes !== undefined
                            && recipePolicy !== undefined) {
                        await setSubscriptionAttributes(deviceAttributes.subscriptions.newRecipes, recipePolicy);
                    }
                    break;
                default:
                    throw "Specify what to do with new recipe subscription!";
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
                    throw "Specify what to do with comments subscription!";
            }
        }

        if(likeFlag) {
            switch(likeFlag) {
                case subscription.subscribe:
                    deviceAttributes.subscriptions.likes = true;
                    break;
                case subscription.unsubscribe:
                    deviceAttributes.subscriptions.likes = false;
                    break;
                default:
                    throw "Specify what to do with likes subscription!";
            }
        }
        // update user object in memory and then update it in db
        user.devices[deviceId] = deviceAttributes;
        await updateUser(user);

        //#endregion Subscriptions

        callback(null, {
            statusCode: 200
        });

    } catch(err) {
        console.log("CATCH, " + JSON.stringify(err));
        callback(err);
    }
};