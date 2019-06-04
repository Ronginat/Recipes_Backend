const AWS = require('aws-sdk');
const nanoid = require('nanoid');

AWS.config.update({region: process.env['REGION']});
const docClient = new AWS.DynamoDB.DocumentClient();
const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();


function setResponse(status, body){
    let response = {
        headers: {
            'Content-Type': 'application/json'},
        body: body,
        statusCode: status
    };
    return response;
}

function dateToString() {
    return new Date().toISOString();
}

function getUserId(token){
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
                return resolve(data.UserAttributes.find(attr => attr.Name === 'sub').Value);
            }    
        });
    });
}

function putRecipe(recipe) {
    const date = dateToString();

    const params = {
        TableName: process.env['RECIPE_TABLE'],
        Item: {
            'id' : recipe.id,
            'sharedKey': process.env['SHARED_KEY'],
            'name' : recipe.name,
            'description': recipe.description,
            'uploader': recipe.uploader,
            'categories': recipe.categories,
            'html': recipe.html,
            'creationDate': recipe.creationDate,
            'lastModifiedDate': date,
            'likes': 0,
            'isDeleted': false
        }
    };

    return new Promise((resolve, reject) => {
        // Call DynamoDB to add the item to the table
        docClient.put(params, function(err, data) {
            if (err) {
                console.log("Error recipe PUT", err);
                return reject(err);
            } 
            else {
                console.log("Success recipe PUT", data);
                return resolve(data);
            }
        });
    });
}


exports.handler = async function(event, context, callback) {
    console.log(event);

    let eventBody = JSON.parse(event['body']);
    
    try {
        const results = {};
                        //let username = await getUsername(event['multyValueHeaders']['Authorization'][0]['AccessToken']);
        eventBody['recipe']['uploader'] = await getUserId(event['headers']['Authorization']);
        console.log('userid: ' + eventBody.recipe.uploader);
        const newId = nanoid(12);
        console.log('generated id = ' + newId);
        eventBody['recipe']['id'] = newId;

        let recipeItem = await putRecipe(eventBody.recipe);  
        //console.log('recipe item in db: \n' + JSON.stringify(recipeItem));

        results['id'] = recipeItem.id;
        
        callback(null, setResponse(200, JSON.stringify(results)));
        
    } catch(err) {
        console.log('got error, ' + err);
        callback(null, setResponse(400, err));
    }
};