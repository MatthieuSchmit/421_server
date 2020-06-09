/**
 * Parameters
 */
var webSocketsServerPort = 34263; // Adapt to the listening port number you want to use
/**
 * Global variables
 */
// websocket and http servers
var webSocketServer = require('websocket').server;
var http = require('http');
/**
 * HTTP server to implement WebSockets
 */
var server = http.createServer(function(request, response) {
    // Not important for us. We're writing WebSocket server,
    // not HTTP server
});
server.listen(webSocketsServerPort, function() {
    console.log((new Date()) + " Server is listening on port "
        + webSocketsServerPort);
});

/**
 * WebSocket server
 */
var wsServer = new webSocketServer({
    // WebSocket server is tied to a HTTP server. WebSocket
    // request is just an enhanced HTTP request. For more info
    // http://tools.ietf.org/html/rfc6455#page-6
    httpServer: server
});

// This callback function is called every time someone
// tries to connect to the WebSocket server
wsServer.on('request', function(request) {

    var connection = request.accept(null, request.origin);

    //
    // New Player has connected.  So let's record its socket
    //
    var player = new Player(request.key, connection);

    //
    // Add the player to the list of all players
    //
    Players.push(player);

    //
    // We need to return the unique id of that player to the player itself
    //
    connection.sendUTF(JSON.stringify({action: 'connect', data: player.id}));

    //
    // Listen to any message sent by that player
    //
    connection.on('message', function(data) {

        //
        // Process the requested action
        //
        var message = JSON.parse(data.utf8Data);
        switch(message.action){
            //
            // When the user sends the "join" action, he provides a name.
            // Let's record it and as the player has a name, let's
            // broadcast the list of all the players to everyone
            //
            case 'join':
                player.name = message.data;
                connection.sendUTF(JSON.stringify({'action':'joined', "data": player.getId()}));
                break;

             //
             // Create party
            case 'new_party':
                var party = new Party(makeid(8));
                party.name = message.data;
                party.players.push(player);
                party.host = player.id;
                Parties.push(party);
                player.partyID = party.id;
                player.partyIndex = party.index;
                BroadcastParty(party.index, 'party_info');
                break;

            //
            // Join party
            case 'join_party':
                // message.data => party.id
                player.setParty(message.data);
                BroadcastParty(player.partyIndex, 'party_info');
                break;

            //
            // Begin the party. Close players list
            case 'play_party':
                // message.data => party.id
                Parties.forEach(function (party, index) {
                    if (party.id == message.data) {
                        Parties[index].open = 'false';
                        BroadcastParty(index, 'party_play');
                    }
                });
                break;

            case 'action_party':
                Parties.forEach(function (party, index) {
                    if (party.id == player.partyID) {
                        BroadcastPartyAction(index, message.data);
                    }
                });
                break;


            case 'eject':
                // player.id = message.data
                if (player.id == message.data) {
                    // Quit
                    player.ejectParty(player.partyID);
                    player.connection.sendUTF(JSON.stringify({'action' : 'eject','data' : 'eject'}));
                } else {
                    // Eject someone else
                    var ii = 0;
                    Players.forEach(function (pl, index) {
                        if (pl.id == message.data) {
                            ii = index;
                        }
                    });
                    Players[ii].ejectParty(player.partyIndex);
                    Players[ii].partyID = null;
                    Players[ii].partyIndex = null;
                    Players[ii].connection.sendUTF(JSON.stringify({'action' : 'eject','data' : 'eject'}));
                }
                BroadcastParty(player.partyIndex, 'party_info');
                break;
        }
    });

    // user disconnected
    connection.on('close', function(connection) {
        console.log("Quit");
        var ii = 0;
        Players.forEach(function (p, index) {
           if (p.id == player.id) {
               if (player.partyID != null) {
                   // Remove from party
                   player.ejectParty(player.partyID);
               }
               player.connection = null;
               ii = index;
           }
        });
        Players.splice(ii, 1);
    });
});

// -----------------------------------------------------------
// List of all players
// -----------------------------------------------------------
var Players = [];

function Player(id, connection) {
    this.id = id;
    this.connection = connection;
    this.name = "";
    this.index = Players.length;
    this.partyID = null;
    this.partyIndex = null;
}

Player.prototype = {
    getId: function(){
        return {name: this.name, id: this.id};
    },
    setParty: function(id) {
      var self = this;
      Parties.forEach(function (party, index) {
         if (party.id == id) {
             self.partyID = id;
             self.partyIndex = index;
             Parties[index].players.push(self);
         }
      });
    },
    ejectParty: function (id) {
        var self = this;
        var indexParty = 0;
        var indexPlayer = 0;

        Parties.forEach(function (party, index) {
            if (party.id == id) {
                indexParty = index;
                party.players.forEach(function (pl, ii) {
                    if (pl == self.id) {
                        indexPlayer = ii;
                    }
                });
                self.partyID = null;
                self.partyIndex = null;
            }
        });

        // Remove
        Parties[indexParty].players.slice(indexPlayer, 1);
        if (Parties[indexParty].players.length === 0) {
            Parties.slice(indexParty, 1);
        }
    },
};

// -----------------------------------------------------------
// List of all parties
// -----------------------------------------------------------
var Parties = [];

function Party(id) {
    this.id = id;
    this.name = "";
    this.players = [];
    this.index = Parties.length;
    this.host = "";
    this.open = 'true';
    this.nbRound = 1;
    this.token = 21;
    this.rolled = 0;
}

Party.prototype = {
  getId: function () {
      return {name: this.name, id: this.id, players: this.players, host: this.host, open: this.open}
  },
};



// ---------------------------------------------------------
// Broadcast the list of all players
// ---------------------------------------------------------
function BroadcastParty(party_index, action) {
    if (Parties[party_index]) {
        console.log(Parties[party_index]);

        var party = {
            'id' : Parties[party_index].id,
            'name' : Parties[party_index].name,
            'index' : Parties[party_index].index,
            'host' : Parties[party_index].host,
            'open' : Parties[party_index].open,
            'nbRound' : Parties[party_index].nbRound,
            'token' : Parties[party_index].token,
            'players' : [],
            'rolled' : Parties[party_index].rolled,
        };
        var playersList = [];

        Parties[party_index].players.forEach(function (player) {
            if (player.name !== ''){
                playersList.push(player.getId());
            }
        });

        party.players = playersList;

        var message = JSON.stringify({
            'action' : action,
            'data' : party
        });

        Parties[party_index].players.forEach(function (player) {
            player.connection.sendUTF(message);
        });
    }
}


// ---------------------------------------------------------
// Broadcast party actions
// ---------------------------------------------------------
function BroadcastPartyAction(party_index, data) {
    if (Parties[party_index]) {

        var message = JSON.stringify({
            'action' : 'party_action',
            'data' : data
        });

        Parties[party_index].players.forEach(function (player) {
            player.connection.sendUTF(message);
        });
    }
}



// ---------------------------------------------------------
// Create random string
// ---------------------------------------------------------
function makeid(length) {
    var result           = '';
    var characters       = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz023456789-';
    var charactersLength = characters.length;
    for ( var i = 0; i < length; i++ ) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}
