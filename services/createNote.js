const { getDB } = require('../db');
const { marked } = require('marked');

const createNote = async (userId, title, text) => {
  const db = getDB();

  const note = {
    user_id: userId,
    title: title,
    text: text,
    html: marked(text),
    created: new Date(),
    isArchived: false,
  };

  const result = await db.collection('notes').insertOne(note);

  note._id = result.insertedId;

  return note;
};

module.exports = {
  createNote,
};
