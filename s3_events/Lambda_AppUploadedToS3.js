const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});

const lambda = new AWS.Lambda({
    region: AWS.config.region,
    apiVersion: '2015-03-31'
});

function decodeVersion(name) {
    return name.split("/")[1].split(".")[0]; // change in the future
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

exports.handler = async function(event, context, callback) {
    const record = event['Records'][0]['s3'];
    const uploadedName = record['object']['key'];
    //const bucket = record['bucket']['name'];

    try {
        await invokePublishLambda(decodeVersion(uploadedName));
        
        callback(null);

    } catch(err) {
        console.log("error when sending appUpdate push notification.\n" + err);
        callback(err);
    }
};