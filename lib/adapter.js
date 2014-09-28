/**
 * Module Dependencies
 */

var Promise = require('bluebird');
var util = require('util');
var path = require('path');
var GToken = require('gapitoken');
var googleapis = require('googleapis');
Promise.promisifyAll(googleapis);
var _ = require('lodash');
var redis = require('redis');

/**
 * sails-google-apps
 */

module.exports = (function () {

    var supportedAPIs = [{api: 'admin', version: 'directory_v1'},{api: 'drive', version: 'v2'}];

    var googleConnections = {};


    function GoogleAPIClient(connection,collections){

        
        this.identity = connection.identity;
        this.connection = connection;
        this.collections = collections;
        this.cache = {};
        this.api = {};
    }

    GoogleAPIClient.prototype.initialize  = function(){

        var client = this;

        var authClient = Promise.promisifyAll(new googleapis.auth.JWT(client.connection.auth.iss, client.connection.auth.keyFile || null, client.connection.auth.key || null, client.connection.auth.scopes, client.connection.auth.sub));
        var cache = redis.createClient(this.connection.cache.port,this.connection.cache.host,{ auth_pass: this.connection.cache.password });


        var initializeCache = new Promise(function(resolve,reject){
            cache.on('ready',function(){
                resolve(Promise.promisifyAll(cache));
            });
            cache.on('error',function(err){
                reject(err);
            })
        }).then(function(pCache){
                this.cache = pCache;
                return pCache;
            });


        return googleapis.discover('admin','directory_v1').discover('drive','v2').executeAsync().then(function(apiClient){
            
            client.apiClient = apiClient;
            return client.apiClient;
        }).then(function(apiClient){
            return authClient.authorizeAsync()
        }).then(function(authorized){
            client.authClient = authClient;
            return client;
        }).then(function(client){
            if(!client.connection.cache){
                return;
            }
            return initializeCache;
        });

    };

    GoogleAPIClient.prototype.getGoogleAPI = function(collectionName){

        var collection = this.collections[collectionName];
        var resourcePath = collection.meta.google_resource;
        var apiPath = collection.meta.google_api;
        var schemaPath = collection.meta.google_schema;



        // console.log(this.apiClient)

        var api = this.apiClient[apiPath];



        if(!api) return false;

        var resource = api[resourcePath];

        if(collection.meta.google_resource_action){
            resource = resource[collection.meta.google_resource_action];
        }


        return { resource : resource, resourcePath: resourcePath, schema: api.apiMeta.schemas[schemaPath]};
    };

    GoogleAPIClient.prototype.find = function(collectionName,options){
        

        var client = this;
        var api = this.getGoogleAPI(collectionName);
        var query;
        var findOne;

        options = options || {};



        if(options.where && options.limit == 1){
            findOne = true;
            query = api.resource.get(options.where);
        }
        else{
            options.domain = this.connection.google_domain;

            if(api.resource.list){
                query = api.resource.list(options);
            }
            else{

                query = api.resource.get(options.where);
            }
        }

        return new Promise(function(resolve,reject){
            query.withAuthClient(client.authClient).execute(function(err,data){
                console.log(err)

                if(err) return reject(err);
                resolve(data);
            })
        }).then(function(data){

            
                if(findOne){
                    return [data];
                }
                return data[api.resourcePath];
            });
    };

    GoogleAPIClient.prototype.findOne = function(collectionName,options){
        

        var client = this;
        var api = this.getGoogleAPI(collectionName);
        var query;
        var findOne;

        options = options || {};



        query = api.resource.get(options.where);

        return new Promise(function(resolve,reject){
            query.withAuthClient(client.authClient).execute(function(err,data){

                if(err) return reject(err);
                resolve(data);
            })
        }).then(function(data){
            data.userKey = data.id;
                return [data]
            });
    };

    GoogleAPIClient.prototype.join = function(collectionName,options){

        
        var client = this;
        var api = this.getGoogleAPI(collectionName);
        var query;
        var joinQueries = [];
        var findOne;

        var joins = options.joins;

        // return Promise.all(joins.map(function(join){

        // }))

        delete options.joins;

        return this.find(collectionName,options).then(function(records){
            
            return records;
        })


        // function doJoins(data){

        //     if(findOne){
        //         return options.joins.map(function(join){

        //         })
        //     }


            
        //     return data[api.resourcePath];
        
        // }

        // options = options || {};

        // if(options.where && options.limit == 1){
        //     findOne = true;
        //     query = api.resource.get(options.where);
        // }
        // else{
        //     options.domain = this.connection.google_domain;
        //     query = api.resource.list(options);
        // }

        // return new Promise(function(resolve,reject){
        //     query.withAuthClient(client.authClient).execute(function(err,data){

        //         if(err) return reject(err);
        //         resolve(data);
        //     })

        // }).then(doJoins);
    };



    GoogleAPIClient.prototype.update = function(collectionName,options,data){
        var client = this;
        var api = this.getGoogleAPI(collectionName);
        query = api.resource.update(options.where,data);

        return new Promise(function(resolve,reject){
            query.withAuthClient(client.authClient).execute(function(err,data){

                if(err) return reject(err);
                resolve(data);
            })

        })


    };







    var connections = {};


    var googleAPI;


    var adapter = {
        schema: true,
        syncable: true,

        // Default configuration for connections
        defaults: {
            sync: true,
            schema: true,
            syncable: true,
            // ssl: false,
            // customThings: ['eh']
        //    migrate: 'alter'
        },
        // interfaces: ['semantic','queryable'],



        /**
         *
         * This method runs when a model is initially registered
         * at server-start-time.  This is the only required method.
         *
         * @param  {[type]}   connection [description]
         * @param  {[type]}   collection [description]
         * @param  {Function} cb         [description]
         * @return {[type]}              [description]
         */
        registerConnection: function(connection, collections, cb) {

            if(!connection.identity) return cb(new Error('Connection is missing an identity.'));

            var googleAPIClient = new GoogleAPIClient(connection,collections);

            googleAPIClient.initialize().then(function(cache){
                googleConnections[googleAPIClient.identity] = googleAPIClient;
                return;
            }).nodeify(cb);
        },


        /**
         * Fired when a model is unregistered, typically when the server
         * is killed. Useful for tearing-down remaining open connections,
         * etc.
         *
         * @param  {Function} cb [description]
         * @return {[type]}      [description]
         */
        // Teardown a Connection
        teardown: function (conn, cb) {

            if (typeof conn == 'function') {
                cb = conn;
                conn = null;
            }
            if (!conn) {
                connections = {};
                return cb();
            }
            if(!connections[conn]) return cb();
            delete connections[conn];
            cb();
        },




        /**
         *
         * REQUIRED method if users expect to call Model.find(), Model.findOne(),
         * or related.
         *
         * You should implement this method to respond with an array of instances.
         * Waterline core will take care of supporting all the other different
         * find methods/usages.
         *
         */

        find: function (connectionName, collectionName, options, cb) {
            
            var gConnection = googleConnections[connectionName];
            var collection = gConnection.collections[collectionName];

            gConnection.find(collectionName,options).nodeify(cb);
        },


        findOne: function (connectionName, collectionName, options, cb) {
            var gConnection = googleConnections[connectionName];
            var collection = gConnection.collections[collectionName];

            gConnection.findOne(collectionName,options).nodeify(cb);
        },

        

        create: function (connection, collection, values, cb) {
            return cb();
        },

        update: function (connectionName, collectionName, options, values, cb) {
            var gConnection = googleConnections[connectionName];
            var collection = gConnection.collections[collectionName];

            gConnection.update(collectionName,options,values).nodeify(cb);

        },

        destroy: function (connection, collection, options, values, cb) {
            return cb();
        },

        drop: function(connection, collection, values, cb){

            cb()

        }



    };

    function spawnConnection(resource, fn,cb) {
        
        // wraps it in case the resource was not promise
        var pResource = Promise.cast(resource);
        return pResource.then(fn);
    }

// Expose adapter definition
    return adapter;

})();
