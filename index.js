const Promise = require('bluebird');
const path    = require('path');
const fs      = Promise.promisifyAll(require('fs'));

module.exports = function(serviceEntrypointPath) {
    let env = process.env.NODE_ENV;
    if (env !== 'test') {
        throw new Error(`Invalid environment. Expected NODE_ENV to equal "test" but got "${env}"`);
    }

    const config     = require('bi-config');
    const Migration  = require('bi-db-migrations');
    config.initialize();

    const service   = require(serviceEntrypointPath);
    const sequelize = service.sqlModelManager.sequelize;

    before(function() {
        this.service = service;
        this.migrateDB = migrateDB;
        this.emptyDatabase = emptyDatabase;

        return ensureEmptyDatabase(sequelize).then(function() {
            return migrateDB();
        }).then(function(results) {
            return service.listen();
        });
    });

    after(function() {
        return emptyDatabase(sequelize);
    });

    /**
     */
    function migrateDB() {
        let mig = new Migration.Migration();
        return mig.migrateCmd({
            verbose: false,
            'mig-dir': 'migrations'
        });
    }
}

module.exports.ensureEmptyDatabase = ensureEmptyDatabase;
module.exports.emptyDatabase = emptyDatabase;

/**
 * @private
 */
function ensureEmptyDatabase(sequelize) {
    let p;
    const dbName = sequelize.connectionManager.config.database;

    switch (sequelize.options.dialect) {
        case 'postgres':
            p = ensureEmptyPostgresDatabase(sequelize);
            break;
        case 'mysql':
            p = ensureEmptyMysqlDatabase(sequelize);
            break;
    }

    return p.then(function(results) {
        if (results.pop().count > 0) {
            console.error(`Provided database "${dbName}" is NOT empty. Aborting...`);
            process.exit(1);
        }
    });
}

function ensureEmptyPostgresDatabase(sequelize) {
    const q = `select count(*) from pg_class c
                  join pg_namespace s on s.oid = c.relnamespace
               where s.nspname not in ('pg_catalog', 'information_schema')
                     and s.nspname not like 'pg_%';`;

    return sequelize.query(q, {
        type: sequelize.QueryTypes.SELECT
    });
}

function ensureEmptyMysqlDatabase(sequelize) {
    const dbName = sequelize.connectionManager.config.database;
    const q = "SELECT COUNT(DISTINCT `table_name`) as count FROM `information_schema`.`columns`" +
        " WHERE `table_schema` = '" + dbName + "';";

    return sequelize.query(q, {
        type: sequelize.QueryTypes.SELECT
    });
}

/**
 * @private
 */
function emptyDatabase(sequelize) {
    let safeNames = ['tests', 'test', 'testing']
    ,   dbName    = sequelize.connectionManager.config.database
    ,   dbUser    = sequelize.connectionManager.config.username
    ,   q;

    if (!~safeNames.indexOf(dbName) && process.env.TEST_DB !== dbName) {
        throw new Error(`Expected one of the allowed database names: "${safeNames.join('" | "')}"
        but got "${dbName}". DB will NOT be truncated! export TEST_DB=${dbName} to whitelist the dbname.`);
    }

    switch (sequelize.options.dialect) {
        case 'postgres':
            q = `DROP SCHEMA public CASCADE;
                       CREATE SCHEMA public;
                       GRANT ALL ON SCHEMA public TO ${dbUser};
                       GRANT ALL ON SCHEMA public TO public;`;
            break;
        case 'mysql':
            if (   !sequelize.config.dialectOptions
                || !sequelize.config.dialectOptions.multipleStatements
            ) {
                throw new Error(`"mysql" dialect needs "multipleStatements" option to be allowed. Aborting..`);
            }

            q = "SET FOREIGN_KEY_CHECKS = 0;\n" +
                    "SET GROUP_CONCAT_MAX_LEN=32768;\n" +
                    "SET @tables = NULL;\n" +
                    "SELECT GROUP_CONCAT('`', table_name, '`') INTO @tables" +
                    "  FROM information_schema.tables" +
                    "  WHERE table_schema = (SELECT DATABASE());\n" +
                    "SELECT IFNULL(@tables,'dummy') INTO @tables;\n" +
                    "SET @tables = CONCAT('DROP TABLE IF EXISTS ', @tables);\n" +
                    "PREPARE stmt FROM @tables;\n" +
                    "EXECUTE stmt;\n" +
                    "DEALLOCATE PREPARE stmt;\n" +
                    "SET FOREIGN_KEY_CHECKS = 1;"
            break;
    }

    return sequelize.query(q, {
        type: sequelize.QueryTypes.RAW
    });
}
