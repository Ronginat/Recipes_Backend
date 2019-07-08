const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});

const docClient = new AWS.DynamoDB.DocumentClient();

const lambda = new AWS.Lambda({
    region: AWS.config.region,
    apiVersion: '2015-03-31'
});

/**
 * Input format: app_versions/appName_v1.0.apk
 * @param {string} name - path and name of the app file
 */
function decodeVersion(name) {
    const fileWithExtension = name.split("/")[1];
    const versionWithExtension = fileWithExtension.split("_v")[1];
    const version = versionWithExtension.split(".");

    version.splice(-1, 1);
    return version.join('.');

    //return name.split("/")[1].split(".")[0]; // change in the future
}

function decodePlatform(name) {
    return "android"; // may change in the future
}

function dateToString() {
    return new Date().toISOString();
}

function putNewVersionInDB(app) {
    const date = dateToString();

    const params = {
        TableName: process.env['RECIPE_TABLE'],
        Item: {
            'partitionKey': process.env['APP_PARTITION'], // app
            'sort': date,
            'name' : app.split("/")[1],
            'version': decodeVersion(app),
            'platform': decodePlatform(app),
            'minSdk': parseInt(process.env['MIN_SDK'], 10)
        }
    };

    return new Promise((resolve, reject) => {
        // Call DynamoDB to add the item to the table
        docClient.put(params, function(err, data) {
            if (err) {
                console.log("Error app version PUT", err);
                return reject(err);
            } 
            else {
                console.log("Success app version PUT", data);
                return resolve(data.Item);
            }
        });
    });
}

function invokePublishLambda(version) {
    const payload = {
        "message": "click to update",
        "title": "version " + version + " of the app is availabe",
        "topic": process.env['APP_UPDATES_TOPIC'],
        "channel": "appUpdates"
    };
    const params = {
        FunctionName: process.env['SNS_PUBLISH_LAMBDA'],
        InvocationType: 'Event',
        LogType: 'None',
        Payload: JSON.stringify(payload)
    };

    return new Promise((resolve, reject) => {
        lambda.invoke(params, (err,data) => {
            if (err) { 
                console.log(err, err.stack);
                reject(err);
            }
            else {
                console.log(data);
                return resolve(data);
            }
        });
    });
}

exports.handler = async (event, context, callback) => {
    const record = event['Records'][0]['s3'];
    const uploadedName = record['object']['key'];
    //const bucket = record['bucket']['name'];

    try {
        //await invokePublishLambda(decodeVersion(uploadedName));
        await Promise.all([
            invokePublishLambda(decodeVersion(uploadedName)),
            putNewVersionInDB(uploadedName)
        ]);
        
        callback(null);

    } catch(err) {
        console.log("err ", JSON.stringify(err));
        callback(err);
    }
};