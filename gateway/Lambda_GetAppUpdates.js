const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});

const docClient = new AWS.DynamoDB.DocumentClient();
const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();
const s3 = new AWS.S3();

const pathParameters = {
    device: "device"
};

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
        TableName: process.env['RECIPE_TABLE'],
        Key: {
            partitionKey: process.env['USERS_PARTITION'], // user
            sort: username
        },
        ProjectionExpression: "#username, devices, favorites",
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

function getLatestAppVersion(app) {
    const params = {
        Limit: 1,
        TableName: process.env['RECIPE_TABLE'],
        KeyConditionExpression: "partitionKey = :v_key",
        FilterExpression: "(#platform = :v_plat) AND (#version > :v_app) AND (#minSdk <= :v_sdk)",
        ExpressionAttributeNames: {
            "#minSdk": "minSdk",
            "#platform": "platform",
            "#version": "version"
        },
        ExpressionAttributeValues: {
            ":v_key": process.env['APP_PARTITION'], // app
            ":v_sdk": app.clientApiVersion,
            ":v_plat": app.platform,
            ":v_app": app.currentVersion
        },
        ScanIndexForward: false,
        ReturnConsumedCapacity: "TOTAL"
    };

    return new Promise((resolve, reject) => {
        docClient.query(params, (err, data) => {
            if (err) {
                console.error("Unable to query the table. Error JSON:", JSON.stringify(err, null, 2));
                return reject(err);
            } else {
                // print all the data
                console.log("Query succeeded. ", JSON.stringify(data));
                if(data.Count === 0 || data.Items.length === 0) {
                    return resolve(null);
                }
                return resolve(data.Items[0].name);
            }
        });
    });
}

function signUrl(fileName) {
    const myBucket = process.env['BUCKET'];
    const filePath = process.env['APP_FOLDER'] + "/" + fileName;
    const signedUrlExpireSeconds = parseInt(process.env['AVAILABLE_TIME_NUMBER'], 10); //120 seconds

    const params = {
        Bucket: myBucket,
        'Key': filePath,
        Expires: signedUrlExpireSeconds
    };

    return s3.getSignedUrl('getObject', params);
}

exports.handler = async (event, context, callback) => {
    console.log("Received event:", JSON.stringify(event, null, 2));

    try {
        let deviceId = undefined;
        if(event['pathParameters'] && event['pathParameters'][pathParameters.device]) {
            deviceId = event['pathParameters'][pathParameters.device];
        } else {
            throw {
                statusCode: 400,
                message: "request must contain device identifier"
            };
        }

        const username = await getUser(event['headers']['Authorization']);       
        const user = await getUserFromDB(username);

        if(!user.devices || !user.devices[deviceId]) {
            throw {
                statusCode: "500",
                message: "Error fetching latest version, problem with your device."
            };
        }
        const device = user.devices[deviceId];
        if (!device.platform) {
            throw {
                statusCode: 500,
                message: "Error fetching latest version, didn't specify platform."
            };
        }
        if (!device.version) {
            throw {
                statusCode: 500,
                message: "Error fetching latest version, didn't specify os version."
            };
        }

        const fileName = await getLatestAppVersion({
            platform: device.platform,
            currentVersion: device.appVersion,
            clientApiVersion: device.version
        });

        callback(null, {
            statusCode: fileName ? 200 /* OK */ : 204 /* No Content */,
            body: fileName ? JSON.stringify(signUrl(fileName)) : null
        });

    } catch(err) {
        console.log("CATCH, " + JSON.stringify(err));
        callback(null, { 
            statusCode: err.statusCode && err.statusCode === 400 ? 400 : 500, 
            body: JSON.stringify(err.message ? err.message : err)
        });
    }
};