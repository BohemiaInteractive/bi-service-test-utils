const sinon          = require('sinon');
const sinonChai      = require("sinon-chai");
const chai           = require('chai');
const chaiAsPromised = require('chai-as-promised');
const Sequelize      = require('sequelize');
const main           = require('../index.js');
const ENV            = process.env;

//this makes sinon-as-promised available in sinon:
require('sinon-as-promised');

const expect = chai.expect;

chai.use(sinonChai);
chai.use(chaiAsPromised);
chai.should();

before(function() {
    this.exitStub = sinon.stub(process, 'exit');
});

afterEach(function() {
    this.exitStub.reset();
});

[
    {
        name: 'mysql',
        port: 3306,
        dialectOptions: {
            multipleStatements: true
        },
        db: ENV.MYSQL_DATABASE,
        user: ENV.MYSQL_USER,
        password: ENV.MYSQL_PASSWORD
    },
    {
        name: 'postgres',
        port: 5432,
        db: ENV.POSTGRES_DB,
        user: ENV.POSTGRES_USER,
        password: ENV.POSTGRES_PASSWORD
    }
].forEach(function(dialect) {
    describe(dialect.name, function() {

        before(function() {
            this.sequelize = new Sequelize(dialect.db, dialect.user, dialect.password, {
                host: dialect.name,
                port: dialect.port,
                dialect: dialect.name,
                dialectOptions: dialect.dialectOptions
            });
        });

        describe('ensureEmptyDatabase', function() {
            it('should return resolved promise', function() {
                const exitStub = this.exitStub;
                return main.ensureEmptyDatabase(this.sequelize).then(function() {
                    exitStub.should.have.callCount(0);
                });
            });

            it('should exit with non-zero exit code when provided test database is not empty', function() {
                const sequelize = this.sequelize;
                const exitStub = this.exitStub;

                return sequelize.query('create table animal (name VARCHAR(20));', {
                    type: sequelize.QueryTypes.RAW
                }).then(function() {
                    return main.ensureEmptyDatabase(sequelize).then(function() {
                        exitStub.should.have.been.calledOnce;
                        exitStub.should.have.been.calledWith(1);
                    });
                }).catch(function(e) {
                    throw e
                });
            });
        });

        describe('emptyDatabase', function() {
            it('should remove all tables from the database', function() {
                const sequelize = this.sequelize;
                const exitStub = this.exitStub;

                return sequelize.query('create table animal2 (name VARCHAR(20));', {
                    type: sequelize.QueryTypes.RAW
                }).then(function() {
                    return main.emptyDatabase(sequelize).then(function() {
                        exitStub.should.have.callCount(0);
                        return main.ensureEmptyDatabase(sequelize).then(function() {
                            exitStub.should.have.callCount(0);
                        });
                    });
                }).catch(function(e) {
                    throw e
                });
            });
        });
    });
});

