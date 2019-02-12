const AWS = require('aws-sdk');

AWS.config.update({region: process.env['SNS_REGION']});

const sns = new AWS.SNS({
    region: process.env['SNS_REGION'],
    apiVersion: '2010-03-31'
});

//const preTopicArn = process.env['TOPIC_ARN_PREFIX'];

const buildFCMPayloadString = (event) => {
    return JSON.stringify({
        data: { //notification
            message: event.message,
            title: event.title,
            channel: event.channel,
            id: event.id
        }
    });
};

exports.handler = (event) => {
    const eventText = JSON.stringify(event, null, 2);
    console.log("Received event:", eventText);
    const platform = "android";
    let payloadKey = '', payload = '';

    if (platform === 'android') {
        payloadKey = 'GCM';
        payload = buildFCMPayloadString(event);

    }
    let snsMessage = {};
    snsMessage[payloadKey] = payload;
    snsMessage["default"] = event.message;
    const params = {
        Message: JSON.stringify(snsMessage),
        MessageStructure: "json",
        //Subject: event.subject,
        MessageAttributes: event.messageAttributes,
        TopicArn: process.env['TOPIC_ARN_PREFIX'] + event.topic
    };
    console.log(JSON.stringify(snsMessage, null, 2));
    sns.publish(params, (err, data) => {
        if(err) {
            console.log(err, err.stack);
            throw err;
        } else {
            console.log(data);
            return data;
        }
    });
};

const MessageAttributes = {
    "id": {
        DataType: "Number",
        StringValue: recipe.id
    }
};
