require('dotenv').config({
  quiet: true,
});

const express = require('express');
const nunjucks = require('nunjucks');
const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const puppeteer = require('puppeteer');
const { marked } = require('marked');
const { ObjectId } = require('mongodb');
const { connectDB } = require('./db');
const { createNote } = require('./services/createNote');
const { escapeRegex } = require('./services/escapeRegex');
const { sanitizeFilename } = require('./services/sanitizeFilename');

const app = express();

nunjucks.configure('views', {
  autoescape: true,
  express: app,
});

const authMiddleware = async (req, res, next) => {
  const sessionId = req.cookies.sessionId;

  if (!sessionId || !ObjectId.isValid(sessionId)) {
    return res.status(401).redirect('/');
  }

  try {
    const session = await req.db.collection('sessions').findOne({
      _id: new ObjectId(sessionId),
    });

    if (!session) {
      return res.status(401).redirect('/');
    }

    const user = await req.db.collection('users').findOne({
      _id: session.user_id,
    });

    if (!user) {
      return res.status(401).redirect('/');
    }

    req.user = user;
    req.sessionId = sessionId;

    return next();
  } catch (error) {
    return res.status(500).send('Server error');
  }
};

const notAuthMiddleware = async (req, res, next) => {
  const sessionId = req.cookies.sessionId;

  if (!sessionId || !ObjectId.isValid(sessionId)) {
    return next();
  }

  try {
    const session = await req.db.collection('sessions').findOne({
      _id: new ObjectId(sessionId),
    });

    if (!session) {
      return next();
    }

    const user = await req.db.collection('users').findOne({
      _id: session.user_id,
    });

    if (!user) {
      return next();
    }

    return res.redirect('/dashboard');
  } catch (error) {
    return res.status(500).send('Server error');
  }
};

app.set('view engine', 'njk');

app.use(express.json());
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(async (req, res, next) => {
  try {
    req.db = await connectDB();

    return next();
  } catch (error) {
    return next(error);
  }
});

app.get('/', notAuthMiddleware, (req, res) => {
  res.render('index');
});

app.get('/dashboard', authMiddleware, (req, res) => {
  res.render('dashboard', {
    username: req.user.username,
  });
});

app.post('/signup', async (req, res) => {
  const username = req.body.username?.trim();
  const password = req.body.password?.trim();

  if (!username || !password) {
    return res.status(400).render('index', {
      authError: 'Введите имя пользователя и пароль!',
    });
  }

  try {
    const user = await req.db.collection('users').findOne({
      username: username,
    });

    if (user) {
      return res.status(409).render('index', {
        authError: 'Пользователь c таким именем уже существует!',
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
      username: username,
      password: hashedPassword,
    };

    const result = await req.db.collection('users').insertOne(newUser);

    const demoNoteText = await fs.readFile(path.join(__dirname, 'demo-note.md'), 'utf8');

    await createNote(result.insertedId, 'Demo', demoNoteText);

    return res.status(200).render('index', {
      successMessage: 'Регистрация завершена. Используйте ваши имя и пароль для входа!',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).send('Не удалось зарегистрировать пользователя. Попробуйте снова.');
  }
});

app.post('/login', async (req, res) => {
  const username = req.body.username?.trim();
  const password = req.body.password?.trim();

  if (!username || !password) {
    return res.status(400).render('index', {
      authError: 'Введите имя пользователя и пароль!',
    });
  }

  try {
    const user = await req.db.collection('users').findOne({
      username: username,
    });

    if (!user || ! await bcrypt.compare(password, user.password)) {
      return res.render('index', {
        authError: 'Неверные имя пользователя или пароль!',
      });
    }

    const session = {
      user_id: user._id,
    };

    const result = await req.db.collection('sessions').insertOne(session);

    res.cookie('sessionId', result.insertedId.toString(), {
      httpOnly: true,
    });

    return res.status(200).redirect('/dashboard');
  } catch (error) {
    console.error(error);

    return res.status(500).send('Не удалось выполнить вход. Попробуйте снова.');
  }
});

app.get('/logout', async (req, res) => {
  const sessionId = req.cookies.sessionId;

  try {
    if (sessionId && ObjectId.isValid(sessionId)) {
      await req.db.collection('sessions').deleteOne({
        _id: new ObjectId(sessionId),
      });
    }

    res.clearCookie('sessionId', {
      httpOnly: true,
    });

    return res.redirect('/');
  } catch (error) {
    console.error(error);

    return res.status(500).send('Не удалось выйти из системы. Попробуйте снова.');
  }
});

app.get('/api/notes', authMiddleware, async (req, res) => {
  const { age = '1month', search = '', page = 1 } = req.query;

  const oneMonth = 30 * 24 * 60 * 60 * 1000;
  const notesOnOnePage = 20;

  const escapedSearch = search ? escapeRegex(search) : null;

  try {
    const filter = {
      user_id: req.user._id,
      isArchived: false,
    };

    switch (age) {
      case '1month':
        filter.created = {
          $gt: new Date(Date.now() - oneMonth)
        };
        break;
      case '3months':
        filter.created = {
          $gt: new Date(Date.now() - 3 * oneMonth)
        };
        break;
      case 'archive':
        filter.isArchived = true;
        break;
    }

    if (escapedSearch) {
      filter.title = {
        $regex: escapedSearch,
        $options: 'i',
      };
    }

    const notes = await req.db.collection('notes').find(filter).sort({
      created: -1,
    }).skip(notesOnOnePage * (+page - 1)).limit(notesOnOnePage + 1).toArray();

    const hasMore = notes.length > notesOnOnePage;

    if (escapedSearch) {
      const regex = new RegExp(escapedSearch, 'ig');

      notes.forEach(note => {
        note.highlights = note.title.replace(regex, '<mark>$&</mark>')
      });
    }

    return res.json({
      data: notes.slice(0, notesOnOnePage),
      hasMore: hasMore,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).send('Не удалось загрузить список заметок. Попробуйте обновить страницу.');
  }
});

app.post('/api/notes', authMiddleware, async (req, res) => {
  const title = req.body.title?.trim();
  const text = req.body.text?.trim();

  try {
    const note = await createNote(req.user._id, title, text);

    return res.status(201).json(note);
  } catch (error) {
    console.error(error);

    return res.status(500).send('Не удалось сохранить заметку. Попробуйте снова.');
  }
});

app.get('/api/notes/:id', authMiddleware, async (req, res) => {
  try {
    const note = await req.db.collection('notes').findOne({
      _id: new ObjectId(req.params.id),
      user_id: req.user._id,
    });

    if (!note) {
      return res.status(404).send('Такая заметка не существует!');
    }

    return res.status(200).json(note);
  } catch (error) {
    console.error(error);

    return res.status(500).send('Не удалось загрузить заметку. Попробуйте обновить страницу.');
  }
});

app.patch('/api/notes/:id', authMiddleware, async (req, res) => {
  const { title, text, isArchived } = req.body;

  const newValues = {};

  if (title !== undefined) {
    newValues.title = title;
  }

  if (text !== undefined) {
    newValues.text = text;
    newValues.html = marked(text);
  }

  if (isArchived !== undefined) {
    newValues.isArchived = isArchived;
  }

  try {
    const result = await req.db.collection('notes').updateOne({
      _id: new ObjectId(req.params.id),
      user_id: req.user._id,
    }, {
      $set: newValues,
    });

    if (!result.matchedCount) {
      return res.status(404).send('Такая заметка не существует!');
    }

    const note = await req.db.collection('notes').findOne({
      _id: new ObjectId(req.params.id),
      user_id: req.user._id,
    });

    return res.status(200).json(note);
  } catch (error) {
    console.error(error);

    return res.status(500).send('Не удалось сохранить изменения. Попробуйте снова.');
  }
});

app.delete('/api/notes/:id', authMiddleware, async (req, res) => {
  try {
    const result = await req.db.collection('notes').deleteOne({
      _id: new ObjectId(req.params.id),
      user_id: req.user._id,
    });

    if (!result.deletedCount) {
      return res.status(404).send('Такая заметка не существует!');
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error(error);

    return res.status(500).send('Не удалось удалить заметку. Попробуйте снова.');
  }
});

app.delete('/api/notes', authMiddleware, async (req, res) => {
  try {
    await req.db.collection('notes').deleteMany({
      user_id: req.user._id,
      isArchived: true,
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error(error);

    return res.status(500).send('Не удалось удалить архивные заметки. Попробуйте снова.');
  }
});

app.get('/api/notes/:id/pdf', authMiddleware, async (req, res) => {
  let browser;

  try {
    const note = await req.db.collection('notes').findOne({
      _id: new ObjectId(req.params.id),
      user_id: req.user._id,
    });

    if (!note) {
      return res.status(404).send('Такая заметка не существует!');
    }

    browser = await puppeteer.launch();
    const page = await browser.newPage();

    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <body>
          ${note.html}
        </body>
      </html>
      `);

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
    });

    res.setHeader(
      'Content-Type',
      'application/pdf'
    );

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(sanitizeFilename(note.title)) || 'note'}.pdf"`
    );

    await page.close();

    return res.send(Buffer.from(pdf));
  } catch (error) {
    if (!res.headersSent) {
      console.error(error);

      return res.status(500).send('Не удалось сформировать PDF. Попробуйте снова.');
    }
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

app.use((req, res) => {
  res.status(404).render('404');
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`  Listening on http://localhost:${port}`);
});
