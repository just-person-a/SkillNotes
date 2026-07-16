require('dotenv').config({
  quiet: true,
});

const { MongoClient } = require('mongodb');

const client = new MongoClient(process.env.DB_URI);

let db;

const connectDB = async () => {
  if (db) {
    return db;
  }

  await client.connect();

  db = client.db('SkillNotes');

  await createIndexes();

  return db;
};

const getDB = () => {
  return db;
};

const createIndexes = async () => {
  await db.collection('users').createIndex({
    username: 1,
  }, {
    unique: true,
  });

  await db.collection('notes').createIndex({
    user_id: 1,
    isArchived: 1,
    created: -1,
  });
};

module.exports = {
  connectDB,
  getDB,
};
