var Swagger = require('swagger-client');
var open = require('open');
var rp = require('request-promise');
var store = require('./store');
var http            = require('http'),
    express         = require('express'),
    session = require('express-session');

// config items
var pollInterval = 1000;
var directLineSecret = 'Gi0llUgs4G4.cwA.g9w.mUtbQC_Md9okZ3BmMPMRM0wCdPOlhq0F_F6oS112YlY';
var directLineClientName = 'mercerpocbotmar_1';
var directLineSpecUrl = 'https://docs.botframework.com/en-us/restapi/directline3/swagger.json';
var path = __dirname + '/views/';

var _client, _conversationId, watermark=0;
var refreshIntervalId;//, prev_msg_id=0, curr_msg_id=0;



var app = express();

app.use(session({ secret: 'somesecrettokenhere', resave: false,
  saveUninitialized: true, cookie: { maxAge: 1200000 }}))


//*** Defining api router
var webchatRouter = express.Router();
app.use('/bot', webchatRouter);

webchatRouter.route('/user/:userid/:pwd')
.post(function(req, res){
    var sess = req.session;
    var userid = req.params.userid;
    var pwd = req.params.pwd;
    //console.log(userid);
    //console.log(pwd);
    var user = store.validateuser(userid, pwd);
    console.log(user.name);
    if(user){
        sess.username = user.name;
        res.json({success:true,username:sess.username, dob: user.dob, ssn:user.ssn, address: user.address,cert: user.certno, telephone: user.phone })
    }else{
        res.json({success:false});
    }
});

var directLineClient = rp(directLineSpecUrl)
.then(function (spec) {
    // client
    return new Swagger({
        spec: JSON.parse(spec.trim()),
        usePromise: true
    });
})
.then(function (client) {
    // add authorization header to client
    client.clientAuthorizations.add('AuthorizationBotConnector', new Swagger.ApiKeyAuthorization('Authorization', 'Bearer ' + directLineSecret, 'header'));
    return client;
})
.catch(function (err) {
    console.error('Error initializing DirectLine client', err);
});



    
webchatRouter.route('/init')
.get(function(req, res){
    directLineClient
    .then(function (client) {
        client.Conversations.Conversations_StartConversation()                          // create conversation
            .then(function (response) {
                return response.obj.conversationId;
            })                            // obtain id
            .then(function (conversationId) {
                _client = client;
                _conversationId = conversationId;
                console.log('Starting polling message for conversationId: ' + _conversationId);
                //var watermark = null;
                refreshIntervalId = setInterval(function(){
                console.log("calling retry: " + _conversationId);
                _client.Conversations.Conversations_GetActivities({ conversationId: _conversationId, watermark: watermark })
                    .then(function (response) {
                        watermark = response.obj.watermark;                                 // use watermark so subsequent requests skip old messages 
                        printMessages(response.obj.activities, res);
                    });
                }, 1000);
            });
    })

});



webchatRouter.route('/webchat')
.get(function(req,res){
  res.sendFile(path + "webchat.html");
});

webchatRouter.route('/resp')
.get(function(req, res){
    //var watermark = null;
    if(_client){
        console.log("calling retry: " + _conversationId);
        _client.Conversations.Conversations_GetActivities({ conversationId: _conversationId, watermark: watermark })
        .then(function (response) {
            watermark = response.obj.watermark;                                 // use watermark so subsequent requests skip old messages 
            printMessages(response.obj.activities, res);
        });
    }
});


webchatRouter.route('/post/:message')
.get(function(req, res){
    var sess = req.session;
    if(sess.username){
        var message = req.params.message;
        console.log(message);
        // send message
        _client.Conversations.Conversations_PostActivity(
        {
            conversationId: _conversationId,
            activity: {
                textFormat: 'plain',
                text: message,
                type: 'message',
                from: {
                    id: sess.username,
                    name: sess.username
                }
            }
        })
    .then(function (spec) {
            refreshIntervalId = setInterval(function(){
            console.log("calling retry: " + _conversationId);
            _client.Conversations.Conversations_GetActivities({ conversationId: _conversationId, watermark: watermark })
                .then(function (response) {
                    watermark = response.obj.watermark;                                 // use watermark so subsequent requests skip old messages 
                    printMessages(response.obj.activities, res);
                });
            }, 1000);
        })
        .catch(function (err) {
            console.error('Error sending message:', err);
            res.json({result:"error", error_msg: 'Error sending message:', err});
        });
    }else{
        res.json({data: "it seems you have not logged in yet. Please login to confirm your identity"});
    }
    
});

// Read from console (stdin) and send input to conversation using DirectLine client
function sendMessagesFromConsole(client, conversationId) {
    var stdin = process.openStdin();
    process.stdout.write('Command> ');
    stdin.addListener('data', function (e) {
        var input = e.toString().trim();
        if (input) {
            // exit
            if (input.toLowerCase() === 'exit') {
                return process.exit();
            }

            // send message
            client.Conversations.Conversations_PostActivity(
                {
                    conversationId: conversationId,
                    activity: {
                        textFormat: 'plain',
                        text: input,
                        type: 'message',
                        from: {
                            id: directLineClientName,
                            name: directLineClientName
                        }
                    }
                }).catch(function (err) {
                    console.error('Error sending message:', err);
                });

            process.stdout.write('Command> ');
        }
    });
}


/*function getMsgId(msg_id){
    var splitstr = msg_id.split('|');
    if(splitstr[1])
        return  Number(splitstr[1]);
}*/

// Helpers methods
function printMessages(activities, res) {
    if (activities && activities.length) {
        
        // ignore own messages
        activities = activities.filter(function (m) { return m.from.id !== directLineClientName });
        //console.log(activities);
        if (activities.length) {
            var response="";
            for(var i=0; i< activities.length; i++){
                //curr_msg_id = getMsgId(activities[i].id);
                //if(curr_msg_id > prev_msg_id){
                    response += printMessage(activities[i], res);
                //}
            }
            //if(curr_msg_id > prev_msg_id)
            //{
                console.log(response);
                res.json({data: response});
            //    prev_msg_id = curr_msg_id;
            //    clearInterval(refreshIntervalId);
            //}
        }
    }
}

function printMessage(activity, res) {

    var response="";
    if (activity.text) {
        if(activity.text.length > 0)
            response += '<p>' + activity.text + '</p>';
    }

    if (activity.attachments) {
        activity.attachments.forEach(function (attachment) {
            switch (attachment.contentType) {
                case "application/vnd.microsoft.card.hero":
                     response += renderHeroCard(attachment, res);
                    break;

                case "image/png":
                    console.log('Opening the requested image ' + attachment.contentUrl);
                    open(attachment.contentUrl);
                    break;
            }
        });
    }
    return response;
}



function renderHeroCard(attachment, res) {
    var htmltext = "";
    /*if(attachment.content.images){
        htmltext += '<img style="height:60px;width:60px;" src="' + attachment.content.images[0].url + '"></img>';
    }*/
    if(attachment.content.title){
        htmltext += '<h4>' + attachment.content.title + '</h4>';
    }
    
    if(attachment.content.subtitle){
        htmltext += '<p>' + attachment.content.subtitle + '</p>';
    }
    if(attachment.content.buttons && attachment.content.buttons.length){
        attachment.content.buttons.forEach(function (button) {
            htmltext += '<input type="button" onclick="hello(this)" value="' + button.title + '" id="' + button.value + '">'
            //htmltext += '<button onclick="javascript:hello()" id="' + button.value + '"  class="btn btn-info" style="width:100px;vertical-align: center;"><span class="glyphicon glyphicon-ok"></span>' + button.value + ' </button>&nbsp;&nbsp;';
        });
    }
    htmltext += "<br>";
    return htmltext;
}

app.use(express.static(__dirname));
var port = process.env.PORT || 8080;

app.listen(port, function () {
  console.log("App is running on port " + port);
});

/*var http = require('http');

http.createServer(function (req, res) {
    
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('Hello, world!');
    
}).listen(process.env.PORT || 8080);*/