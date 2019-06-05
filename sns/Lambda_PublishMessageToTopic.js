const AWS = require('aws-sdk');

AWS.config.update({region: process.env['SNS_REGION']});

const sns = new AWS.SNS({
    region: process.env['SNS_REGION'],
    apiVersion: '2010-03-31'
});

/**
 * Lambda for publish sns messages to users
 */

//https://engineering.upside.com/rolling-your-own-mobile-push-with-node-and-sns-23b167c7e06

const buildFCMPayloadString = (eventData) => {

    return JSON.stringify({
        data: eventData
        /* data: { //notification
            message: event.message,
            title: event.title,
            channel: event.channel,
            id: event.id
        } */
    });
};

exports.handler = (event) => {
    const eventText = JSON.stringify(event, null, 2);
    console.log("Received event:", eventText);
    const platform = "android";
    let payloadKey = '', payload = '';
    const eventData = {...event};
    delete eventData.topic;
    delete eventData.target;
    delete eventData.subject;
    delete eventData.messageAttributes;

    if (platform === 'android') {
        payloadKey = 'GCM';
        payload = buildFCMPayloadString(eventData);

    }
    let snsMessage = {};
    snsMessage[payloadKey] = payload;
    snsMessage["default"] = event.message;
    const params = {
        Message: JSON.stringify(snsMessage),
        MessageStructure: "json",
        //Subject: event.subject,
        MessageAttributes: event.messageAttributes,
        //TopicArn: process.env['TOPIC_ARN_PREFIX'] + event.topic
    };
    if(event.target !== undefined) {
        params['TargetArn'] = event.target;
    } else {
        params['TopicArn'] = process.env['TOPIC_ARN_PREFIX'] + event.topic;
    }
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