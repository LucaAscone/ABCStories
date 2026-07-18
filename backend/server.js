require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const SALT_ROUNDS = 12;

// Permetti richieste dal frontend Vercel (e da localhost in sviluppo)
const allowedOrigins = [
  'http://localhost:4200',
  'http://localhost:3000',
  process.env.FRONTEND_URL,
].filter(Boolean).map(o => o.replace(/\/$/, '')); // rimuove slash finale

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const normalizedOrigin = origin.replace(/\/$/, '');

    const isAllowed = allowedOrigins.includes(normalizedOrigin) ||
      normalizedOrigin.startsWith('http://localhost:') ||
      normalizedOrigin.startsWith('http://127.0.0.1:') ||
      normalizedOrigin.endsWith('.vercel.app');

    if (isAllowed) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
}));
// Aumentato a 20MB per permettere il trasferimento di immagini Base64
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));

// Connessione DB: usa DATABASE_URL se disponibile (Railway), altrimenti credenziali locali
const pool = process.env.DATABASE_URL
  ? new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
  : new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432'),
  });

// Inizializzazione tabella email_verifications e notifications
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_verifications (
        email VARCHAR(255) PRIMARY KEY,
        code VARCHAR(6) NOT NULL,
        verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('[DATABASE] Tabella email_verifications creata o già esistente.');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
        story_id UUID REFERENCES stories(id) ON DELETE SET NULL,
        chapter_id UUID REFERENCES chapters(id) ON DELETE SET NULL,
        type VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('[DATABASE] Tabella notifications creata o già esistente.');

    await pool.query(`
      ALTER TABLE follows ADD COLUMN IF NOT EXISTS enable_notifications BOOLEAN DEFAULT TRUE;
    `);
    console.log('[DATABASE] Colonna enable_notifications verificata/creata in tabella follows.');

    await pool.query(`
      ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS theme VARCHAR(50) DEFAULT 'tropical',
        ADD COLUMN IF NOT EXISTS notifiche_commenti BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS notifiche_seguaci BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS notifiche_aggiornamenti BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS notifiche_newsletter BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS privacy_profilo_pubblico BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS privacy_mostra_libreria BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS privacy_indicizza BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS reading_font VARCHAR(50) DEFAULT 'sans-serif',
        ADD COLUMN IF NOT EXISTS reading_font_size VARCHAR(50) DEFAULT 'medium',
        ADD COLUMN IF NOT EXISTS reading_mode VARCHAR(50) DEFAULT 'scroll',
        ADD COLUMN IF NOT EXISTS reading_width VARCHAR(50) DEFAULT 'medium',
        ADD COLUMN IF NOT EXISTS sensitive_filter BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS notifiche_risposte_commenti BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS notifiche_like_commenti BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS notifiche_nuovo_follower BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS notifiche_storie_like BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS notifiche_storie_preferiti BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS notifiche_aggiornamenti_nuova_storia BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS notifiche_aggiornamenti_nuovo_capitolo BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS notifiche_aggiornamenti_modifica_storia BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS notifiche_aggiornamenti_modifica_capitolo BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS visualizza_18plus BOOLEAN DEFAULT FALSE;
    `);
    console.log('[DATABASE] Colonne impostazioni verificate/create in tabella users.');

    await pool.query(`
      ALTER TABLE stories 
        ADD COLUMN IF NOT EXISTS is_18_plus BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS completion_status VARCHAR(50) DEFAULT 'in_corso';
    `);
    console.log('[DATABASE] Colonne is_18_plus e completion_status verificate/create in tabella stories.');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS collections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('[DATABASE] Tabella collections creata o già esistente.');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS collection_stories (
        collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        PRIMARY KEY (collection_id, story_id)
      );
    `);
    console.log('[DATABASE] Tabella collection_stories creata o già esistente.');

    await pool.query(`
      ALTER TABLE collection_stories ADD COLUMN IF NOT EXISTS order_index INTEGER;
    `);
    await pool.query(`
      ALTER TABLE collection_stories ALTER COLUMN order_index DROP NOT NULL;
    `);
    console.log('[DATABASE] Colonna order_index verificata in tabella collection_stories.');

    await pool.query(`
      ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS views_count INTEGER DEFAULT 0;
    `);
    await pool.query(`
      ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS post_image TEXT;
    `);
    await pool.query(`
      ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS commented_author VARCHAR(255);
    `);
    await pool.query(`
      ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS commented_text TEXT;
    `);
    await pool.query(`
      ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS commented_type VARCHAR(50);
    `);
    console.log('[DATABASE] Colonne community_posts verificate in tabella community_posts.');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS community_post_bookmarks (
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        post_id UUID REFERENCES community_posts(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, post_id)
      );
    `);
    console.log('[DATABASE] Tabella community_post_bookmarks creata o verificata.');

    // Sottolineature & Collezioni Sottolineature Migrations
    await pool.query(`
      ALTER TABLE collections ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'books';
    `);
    console.log('[DATABASE] Colonna type verificata in tabella collections.');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS highlights (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        paragraph_index INTEGER NOT NULL,
        start_offset INTEGER NOT NULL,
        end_offset INTEGER NOT NULL,
        text TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        color VARCHAR(50) DEFAULT 'rgba(241, 196, 15, 0.3)'
      );
    `);
    console.log('[DATABASE] Tabella highlights creata o verificata.');

    await pool.query(`
      ALTER TABLE highlights ADD COLUMN IF NOT EXISTS color VARCHAR(50) DEFAULT 'rgba(241, 196, 15, 0.3)';
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS collection_highlights (
        collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        highlight_id UUID NOT NULL REFERENCES highlights(id) ON DELETE CASCADE,
        PRIMARY KEY (collection_id, highlight_id)
      );
    `);
    console.log('[DATABASE] Tabella collection_highlights creata o verificata.');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS series (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('[DATABASE] Tabella series creata o verificata.');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS series_stories (
        series_id UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
        story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        order_index INTEGER NOT NULL,
        PRIMARY KEY (series_id, story_id)
      );
    `);
    console.log('[DATABASE] Tabella series_stories creata o verificata.');
  } catch (err) {
    console.error('[DATABASE ERROR] Errore durante la creazione delle tabelle iniziali:', err);
  }
})();

// Helper per generare e inserire notifiche per autori seguiti, like e preferiti
async function triggerNotifications({ senderId, storyId, chapterId, type }) {
  try {
    // 1. Recupera lo username del mittente
    const senderRes = await pool.query('SELECT username FROM users WHERE id = $1', [senderId]);
    if (senderRes.rows.length === 0) return;
    const senderUsername = senderRes.rows[0].username;

    // 2. Recupera il titolo della storia se storyId è presente
    let storyTitle = '';
    if (storyId) {
      const storyRes = await pool.query('SELECT title FROM stories WHERE id = $1', [storyId]);
      if (storyRes.rows.length > 0) {
        storyTitle = storyRes.rows[0].title;
      }
    }

    // 3. Recupera il titolo del capitolo se chapterId è presente
    let chapterTitle = '';
    if (chapterId) {
      const chapterRes = await pool.query('SELECT title FROM chapters WHERE id = $1', [chapterId]);
      if (chapterRes.rows.length > 0) {
        chapterTitle = chapterRes.rows[0].title;
      }
    }

    let message = '';
    let recipientQuery = '';
    let queryParams = [];

    if (type === 'new_story') {
      message = `${senderUsername} ha pubblicato una nuova storia: "${storyTitle}"`;
      recipientQuery = `
        SELECT DISTINCT f.follower_id AS user_id 
        FROM follows f
        JOIN users u ON u.id = f.follower_id
        WHERE f.followed_id = $1 
          AND f.enable_notifications = TRUE 
          AND f.follower_id != $1
          AND u.notifiche_aggiornamenti_nuova_storia = TRUE
      `;
      queryParams = [senderId];
    } else if (type === 'update_story') {
      message = `${senderUsername} ha modificato la storia: "${storyTitle}"`;
      recipientQuery = `
        SELECT DISTINCT user_id FROM (
          SELECT follower_id AS user_id FROM follows WHERE followed_id = $1 AND enable_notifications = TRUE
          UNION
          SELECT user_id FROM story_likes WHERE story_id = $2
          UNION
          SELECT user_id FROM story_bookmarks WHERE story_id = $2
        ) as recipients
        JOIN users u ON u.id = recipients.user_id
        WHERE user_id != $1 AND u.notifiche_aggiornamenti_modifica_storia = TRUE
      `;
      queryParams = [senderId, storyId];
    } else if (type === 'new_chapter') {
      message = `${senderUsername} ha aggiunto un nuovo capitolo a "${storyTitle}": "${chapterTitle}"`;
      recipientQuery = `
        SELECT DISTINCT user_id FROM (
          SELECT follower_id AS user_id FROM follows WHERE followed_id = $1 AND enable_notifications = TRUE
          UNION
          SELECT user_id FROM story_likes WHERE story_id = $2
          UNION
          SELECT user_id FROM story_bookmarks WHERE story_id = $2
        ) as recipients
        JOIN users u ON u.id = recipients.user_id
        WHERE user_id != $1 AND u.notifiche_aggiornamenti_nuovo_capitolo = TRUE
      `;
      queryParams = [senderId, storyId];
    } else if (type === 'update_chapter') {
      message = `${senderUsername} ha modificato il capitolo "${chapterTitle}" nella storia "${storyTitle}"`;
      recipientQuery = `
        SELECT DISTINCT user_id FROM (
          SELECT follower_id AS user_id FROM follows WHERE followed_id = $1 AND enable_notifications = TRUE
          UNION
          SELECT user_id FROM story_likes WHERE story_id = $2
          UNION
          SELECT user_id FROM story_bookmarks WHERE story_id = $2
        ) as recipients
        JOIN users u ON u.id = recipients.user_id
        WHERE user_id != $1 AND u.notifiche_aggiornamenti_modifica_capitolo = TRUE
      `;
      queryParams = [senderId, storyId];
    }

    if (!message || !recipientQuery) return;

    // 5. Trova i destinatari
    const recipientsRes = await pool.query(recipientQuery, queryParams);
    const recipients = recipientsRes.rows;

    // 6. Inserisci le notifiche nel database
    for (const r of recipients) {
      await pool.query(`
        INSERT INTO notifications (user_id, sender_id, story_id, chapter_id, type, message)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [r.user_id, senderId, storyId || null, chapterId || null, type, message]);
    }
  } catch (error) {
    console.error('[NOTIFICATIONS ERROR] Errore durante l invio delle notifiche:', error);
  }
}

// Configurazione Nodemailer per invio email di verifica
const mailConfig = {
  host: process.env.SMTP_HOST || process.env.BREVO_HOST,
  port: parseInt(process.env.SMTP_PORT || process.env.BREVO_PORT || '587', 10),
  secure: (process.env.SMTP_SECURE || process.env.BREVO_SECURE || 'false') === 'true' || (process.env.BREVO_PORT === '465'),
  auth: {
    user: process.env.SMTP_USER || process.env.BREVO_USER,
    pass: process.env.SMTP_PASS || process.env.BREVO_PASS,
  },
  connectionTimeout: 10000, // 10 secondi di timeout per evitare blocchi infiniti
  greetingTimeout: 10000,
  socketTimeout: 10000,
};

const hasSmtpConfig = !!(
  (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) ||
  (process.env.BREVO_HOST && process.env.BREVO_USER && process.env.BREVO_PASS)
);
const hasMailConfig = hasSmtpConfig || !!(process.env.RESEND_API_KEY || process.env.BREVO_API_KEY);
const transporter = hasSmtpConfig ? nodemailer.createTransport(mailConfig) : null;

if (hasMailConfig) {
  console.log('[MAIL] Servizio SMTP configurato con successo.');
} else {
  console.log('[MAIL] SMTP non configurato. Abilitata la modalità di sviluppo (il codice viene loggato in console e inviato nella risposta API).');
}


app.get('/api/prova', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM prova');
    res.json(result.rows);
  }
  catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/user', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users');
    res.json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/user/:id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id, username, email, avatar_url, bio, location, website_url, created_at,
        social_instagram, social_twitter, social_facebook, social_website, social_tiktok, social_linkedin,
        theme, notifiche_commenti, notifiche_seguaci, notifiche_aggiornamenti, notifiche_newsletter,
        privacy_profilo_pubblico, privacy_mostra_libreria, privacy_indicizza,
        reading_font, reading_font_size, reading_mode, reading_width, sensitive_filter, visualizza_18plus,
        notifiche_risposte_commenti, notifiche_like_commenti, notifiche_nuovo_follower,
        notifiche_storie_like, notifiche_storie_preferiti, notifiche_aggiornamenti_nuova_storia,
        notifiche_aggiornamenti_nuovo_capitolo, notifiche_aggiornamenti_modifica_storia, notifiche_aggiornamenti_modifica_capitolo,
        (SELECT count(*) FROM stories WHERE author_id = users.id) as stories_count
      FROM users WHERE id = $1`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/user/profile', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'User ID is required' });
  try {
    const result = await pool.query(`
      SELECT 
        id, username, email, avatar_url, bio, location, website_url, created_at,
        social_instagram, social_twitter, social_facebook, social_website, social_tiktok, social_linkedin,
        theme, notifiche_commenti, notifiche_seguaci, notifiche_aggiornamenti, notifiche_newsletter,
        privacy_profilo_pubblico, privacy_mostra_libreria, privacy_indicizza,
        reading_font, reading_font_size, reading_mode, reading_width, sensitive_filter, visualizza_18plus,
        notifiche_risposte_commenti, notifiche_like_commenti, notifiche_nuovo_follower,
        notifiche_storie_like, notifiche_storie_preferiti, notifiche_aggiornamenti_nuova_storia,
        notifiche_aggiornamenti_nuovo_capitolo, notifiche_aggiornamenti_modifica_storia, notifiche_aggiornamenti_modifica_capitolo,
        (SELECT count(*) FROM stories WHERE author_id = users.id) as stories_count
      FROM users WHERE id = $1`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.put('/api/user/:id', async (req, res) => {
  const {
    username,
    bio,
    location,
    avatar_url,
    social_instagram,
    social_twitter,
    social_facebook,
    social_website,
    social_tiktok,
    social_linkedin,
    theme,
    notifiche_commenti,
    notifiche_seguaci,
    notifiche_aggiornamenti,
    notifiche_newsletter,
    privacy_profilo_pubblico,
    privacy_mostra_libreria,
    privacy_indicizza,
    reading_font,
    reading_font_size,
    reading_mode,
    reading_width,
    sensitive_filter,
    notifiche_risposte_commenti,
    notifiche_like_commenti,
    notifiche_nuovo_follower,
    notifiche_storie_like,
    notifiche_storie_preferiti,
    notifiche_aggiornamenti_nuova_storia,
    notifiche_aggiornamenti_nuovo_capitolo,
    notifiche_aggiornamenti_modifica_storia,
    notifiche_aggiornamenti_modifica_capitolo,
    visualizza_18plus,
    visualizza_18plus_community,
    notifiche_community_like,
    notifiche_community_commento
  } = req.body;
  try {
    const result = await pool.query(`
      UPDATE users 
      SET 
        username = COALESCE($1, username),
        bio = $2,
        location = $3,
        avatar_url = $4,
        social_instagram = $5,
        social_twitter = $6,
        social_facebook = $7,
        social_website = $8,
        social_tiktok = $9,
        social_linkedin = $10,
        theme = COALESCE($11, theme),
        notifiche_commenti = COALESCE($12, notifiche_commenti),
        notifiche_seguaci = COALESCE($13, notifiche_seguaci),
        notifiche_aggiornamenti = COALESCE($14, notifiche_aggiornamenti),
        notifiche_newsletter = COALESCE($15, notifiche_newsletter),
        privacy_profilo_pubblico = COALESCE($16, privacy_profilo_pubblico),
        privacy_mostra_libreria = COALESCE($17, privacy_mostra_libreria),
        privacy_indicizza = COALESCE($18, privacy_indicizza),
        reading_font = COALESCE($19, reading_font),
        reading_font_size = COALESCE($20, reading_font_size),
        reading_mode = COALESCE($21, reading_mode),
        reading_width = COALESCE($22, reading_width),
        sensitive_filter = COALESCE($23, sensitive_filter),
        notifiche_risposte_commenti = COALESCE($24, notifiche_risposte_commenti),
        notifiche_like_commenti = COALESCE($25, notifiche_like_commenti),
        notifiche_nuovo_follower = COALESCE($26, notifiche_nuovo_follower),
        notifiche_storie_like = COALESCE($27, notifiche_storie_like),
        notifiche_storie_preferiti = COALESCE($28, notifiche_storie_preferiti),
        notifiche_aggiornamenti_nuova_storia = COALESCE($29, notifiche_aggiornamenti_nuova_storia),
        notifiche_aggiornamenti_nuovo_capitolo = COALESCE($30, notifiche_aggiornamenti_nuovo_capitolo),
        notifiche_aggiornamenti_modifica_storia = COALESCE($31, notifiche_aggiornamenti_modifica_storia),
        notifiche_aggiornamenti_modifica_capitolo = COALESCE($32, notifiche_aggiornamenti_modifica_capitolo),
        visualizza_18plus = COALESCE($33, visualizza_18plus),
        visualizza_18plus_community = COALESCE($34, visualizza_18plus_community),
        notifiche_community_like = COALESCE($35, notifiche_community_like),
        notifiche_community_commento = COALESCE($36, notifiche_community_commento)
      WHERE id = $37
      RETURNING *
    `, [
      username || null,
      bio || null,
      location || null,
      avatar_url || null,
      social_instagram || null,
      social_twitter || null,
      social_facebook || null,
      social_website || null,
      social_tiktok || null,
      social_linkedin || null,
      theme || null,
      notifiche_commenti !== undefined ? notifiche_commenti : null,
      notifiche_seguaci !== undefined ? notifiche_seguaci : null,
      notifiche_aggiornamenti !== undefined ? notifiche_aggiornamenti : null,
      notifiche_newsletter !== undefined ? notifiche_newsletter : null,
      privacy_profilo_pubblico !== undefined ? privacy_profilo_pubblico : null,
      privacy_mostra_libreria !== undefined ? privacy_mostra_libreria : null,
      privacy_indicizza !== undefined ? privacy_indicizza : null,
      reading_font || null,
      reading_font_size || null,
      reading_mode || null,
      reading_width || null,
      sensitive_filter !== undefined ? sensitive_filter : null,
      notifiche_risposte_commenti !== undefined ? notifiche_risposte_commenti : null,
      notifiche_like_commenti !== undefined ? notifiche_like_commenti : null,
      notifiche_nuovo_follower !== undefined ? notifiche_nuovo_follower : null,
      notifiche_storie_like !== undefined ? notifiche_storie_like : null,
      notifiche_storie_preferiti !== undefined ? notifiche_storie_preferiti : null,
      notifiche_aggiornamenti_nuova_storia !== undefined ? notifiche_aggiornamenti_nuova_storia : null,
      notifiche_aggiornamenti_nuovo_capitolo !== undefined ? notifiche_aggiornamenti_nuovo_capitolo : null,
      notifiche_aggiornamenti_modifica_storia !== undefined ? notifiche_aggiornamenti_modifica_storia : null,
      notifiche_aggiornamenti_modifica_capitolo !== undefined ? notifiche_aggiornamenti_modifica_capitolo : null,
      visualizza_18plus !== undefined ? visualizza_18plus : null,
      visualizza_18plus_community !== undefined ? visualizza_18plus_community : null,
      notifiche_community_like !== undefined ? notifiche_community_like : null,
      notifiche_community_commento !== undefined ? notifiche_community_commento : null,
      req.params.id
    ]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ═══════════════ COLLECTIONS ═══════════════

app.get('/api/users/:userId/collections', async (req, res) => {
  const { userId } = req.params;
  try {
    const collectionsRes = await pool.query(
      'SELECT * FROM collections WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    
    const collections = [];
    for (const col of collectionsRes.rows) {
      if (col.type === 'highlights') {
        const highlightsRes = await pool.query(
          `SELECT h.*, s.title AS story_title, s.image_url AS story_image_url, c.title AS chapter_title 
           FROM collection_highlights ch 
           JOIN highlights h ON h.id = ch.highlight_id 
           JOIN stories s ON s.id = h.story_id
           JOIN chapters c ON c.id = h.chapter_id
           WHERE ch.collection_id = $1`,
          [col.id]
        );
        collections.push({
          ...col,
          stories: [],
          highlights: highlightsRes.rows
        });
      } else {
        const storiesRes = await pool.query(
          `SELECT s.*, u.username as author_name 
           FROM collection_stories cs 
           JOIN stories s ON s.id = cs.story_id 
           JOIN users u ON u.id = s.author_id
           WHERE cs.collection_id = $1`,
          [col.id]
        );
        collections.push({
          ...col,
          stories: storiesRes.rows,
          highlights: []
        });
      }
    }
    res.json(collections);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/users/:userId/collections', async (req, res) => {
  const { userId } = req.params;
  const { name, description, type, storyIds, highlightIds } = req.body;
  const collectionType = type || 'books';
  try {
    const colRes = await pool.query(
      'INSERT INTO collections (user_id, name, description, type) VALUES ($1, $2, $3, $4) RETURNING *',
      [userId, name, description, collectionType]
    );
    const newCollection = colRes.rows[0];
    
    if (collectionType === 'highlights') {
      if (highlightIds && highlightIds.length > 0) {
        for (const highlightId of highlightIds) {
          await pool.query(
            'INSERT INTO collection_highlights (collection_id, highlight_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [newCollection.id, highlightId]
          );
        }
      }
    } else {
      if (storyIds && storyIds.length > 0) {
        for (const storyId of storyIds) {
          await pool.query(
            'INSERT INTO collection_stories (collection_id, story_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [newCollection.id, storyId]
          );
        }
      }
    }
    
    res.status(201).json(newCollection);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.put('/api/collections/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description, storyIds, highlightIds } = req.body;
  try {
    const colRes = await pool.query(
      'UPDATE collections SET name = $1, description = $2 WHERE id = $3 RETURNING *',
      [name, description, id]
    );
    if (colRes.rows.length === 0) {
      return res.status(404).json({ error: 'Collection not found' });
    }
    const collection = colRes.rows[0];
    
    if (collection.type === 'highlights') {
      await pool.query('DELETE FROM collection_highlights WHERE collection_id = $1', [id]);
      if (highlightIds && highlightIds.length > 0) {
        for (const highlightId of highlightIds) {
          await pool.query(
            'INSERT INTO collection_highlights (collection_id, highlight_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, highlightId]
          );
        }
      }
    } else {
      await pool.query('DELETE FROM collection_stories WHERE collection_id = $1', [id]);
      if (storyIds && storyIds.length > 0) {
        for (const storyId of storyIds) {
          await pool.query(
            'INSERT INTO collection_stories (collection_id, story_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, storyId]
          );
        }
      }
    }
    
    res.json(collection);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.delete('/api/collections/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM collections WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Collection not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ═══════════════ SERIES ═══════════════

app.get('/api/users/:userId/series', async (req, res) => {
  const { userId } = req.params;
  try {
    const seriesRes = await pool.query(
      'SELECT * FROM series WHERE author_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    const seriesList = [];
    for (const series of seriesRes.rows) {
      const storiesRes = await pool.query(
        `SELECT s.*, u.username as author_name, ss.order_index 
         FROM series_stories ss 
         JOIN stories s ON s.id = ss.story_id 
         JOIN users u ON u.id = s.author_id
         WHERE ss.series_id = $1
         ORDER BY ss.order_index ASC`,
        [series.id]
      );
      seriesList.push({
        ...series,
        stories: storiesRes.rows
      });
    }
    res.json(seriesList);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/users/:userId/series', async (req, res) => {
  const { userId } = req.params;
  const { name, description, storyIds } = req.body;
  try {
    const seriesRes = await pool.query(
      'INSERT INTO series (author_id, name, description) VALUES ($1, $2, $3) RETURNING *',
      [userId, name, description]
    );
    const newSeries = seriesRes.rows[0];
    
    if (storyIds && storyIds.length > 0) {
      for (let i = 0; i < storyIds.length; i++) {
        await pool.query(
          'INSERT INTO series_stories (series_id, story_id, order_index) VALUES ($1, $2, $3)',
          [newSeries.id, storyIds[i], i + 1]
        );
      }
    }
    
    const storiesRes = await pool.query(
      `SELECT s.*, u.username as author_name, ss.order_index 
       FROM series_stories ss 
       JOIN stories s ON s.id = ss.story_id 
       JOIN users u ON u.id = s.author_id
       WHERE ss.series_id = $1
       ORDER BY ss.order_index ASC`,
      [newSeries.id]
    );
    
    res.status(201).json({
      ...newSeries,
      stories: storiesRes.rows
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.put('/api/series/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description, storyIds } = req.body;
  try {
    const seriesRes = await pool.query(
      'UPDATE series SET name = $1, description = $2 WHERE id = $3 RETURNING *',
      [name, description, id]
    );
    if (seriesRes.rows.length === 0) {
      return res.status(404).json({ error: 'Series not found' });
    }
    const series = seriesRes.rows[0];
    
    await pool.query('DELETE FROM series_stories WHERE series_id = $1', [id]);
    if (storyIds && storyIds.length > 0) {
      for (let i = 0; i < storyIds.length; i++) {
        await pool.query(
          'INSERT INTO series_stories (series_id, story_id, order_index) VALUES ($1, $2, $3)',
          [id, storyIds[i], i + 1]
        );
      }
    }
    
    const storiesRes = await pool.query(
      `SELECT s.*, u.username as author_name, ss.order_index 
       FROM series_stories ss 
       JOIN stories s ON s.id = ss.story_id 
       JOIN users u ON u.id = s.author_id
       WHERE ss.series_id = $1
       ORDER BY ss.order_index ASC`,
      [id]
    );
    
    res.json({
      ...series,
      stories: storiesRes.rows
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.delete('/api/series/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM series WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Series not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/authors/:authorId/series', async (req, res) => {
  const { authorId } = req.params;
  try {
    const seriesRes = await pool.query(
      'SELECT * FROM series WHERE author_id = $1 ORDER BY created_at DESC',
      [authorId]
    );
    const seriesList = [];
    for (const series of seriesRes.rows) {
      const storiesRes = await pool.query(
        `SELECT s.*, u.username as author_name, ss.order_index 
         FROM series_stories ss 
         JOIN stories s ON s.id = ss.story_id 
         JOIN users u ON u.id = s.author_id
         WHERE ss.series_id = $1
         ORDER BY ss.order_index ASC`,
        [series.id]
      );
      seriesList.push({
        ...series,
        stories: storiesRes.rows
      });
    }
    res.json(seriesList);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ═══════════════ HIGHLIGHTS ═══════════════

app.get('/api/community/highlights', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT h.*, 
              u.username AS user_name, 
              s.title AS story_title, 
              s.image_url AS story_image,
              s.is_18_plus,
              c.title AS chapter_title,
              c.order_index AS chapter_order_index,
              (SELECT name FROM users WHERE id = s.author_id) as author_name
       FROM highlights h
       JOIN users u ON u.id = h.user_id
       JOIN stories s ON s.id = h.story_id
       JOIN chapters c ON c.id = h.chapter_id
       ORDER BY h.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Errore get community highlights:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/chapters/:chapterId/highlights', async (req, res) => {
  const { chapterId } = req.params;
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId parameter' });
  }
  try {
    const result = await pool.query(
      'SELECT * FROM highlights WHERE chapter_id = $1 AND user_id = $2',
      [chapterId, userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/users/:userId/highlights', async (req, res) => {
  const { userId } = req.params;
  try {
    const result = await pool.query(
      `SELECT h.*, s.title AS story_title, s.image_url AS story_image_url, c.title AS chapter_title 
       FROM highlights h
       JOIN stories s ON s.id = h.story_id
       JOIN chapters c ON c.id = h.chapter_id
       WHERE h.user_id = $1
       ORDER BY h.created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/highlights', async (req, res) => {
  const { userId, storyId, chapterId, paragraphIndex, startOffset, endOffset, text, color } = req.body;
  if (!userId || !storyId || !chapterId || paragraphIndex === undefined || startOffset === undefined || endOffset === undefined || !text) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO highlights (user_id, story_id, chapter_id, paragraph_index, start_offset, end_offset, text, color) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING *`,
      [userId, storyId, chapterId, paragraphIndex, startOffset, endOffset, text, color || 'rgba(241, 196, 15, 0.3)']
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.delete('/api/highlights/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM highlights WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Highlight not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.put('/api/highlights/:id', async (req, res) => {
  const { id } = req.params;
  const { color, startOffset, endOffset, text } = req.body;
  try {
    const result = await pool.query(
      `UPDATE highlights 
       SET color = COALESCE($1, color),
           start_offset = COALESCE($2, start_offset),
           end_offset = COALESCE($3, end_offset),
           text = COALESCE($4, text)
       WHERE id = $5 
       RETURNING *`,
      [
        color || null,
        startOffset !== undefined ? startOffset : null,
        endOffset !== undefined ? endOffset : null,
        text || null,
        id
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Highlight not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/user/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    // Seleziona l'utente solo tramite l'email
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (result.rows.length > 0) {
      const user = result.rows[0];

      // Confronta la password in chiaro con l'hash estratto dal database
      const isMatch = await bcrypt.compare(password, user.password_hash);

      if (isMatch) {
        // Rimuovi l'hash dall'oggetto user prima di inviarlo al frontend per sicurezza
        delete user.password_hash;

        res.json({ success: true, user });
      } else {
        // Password errata
        res.status(401).json({ error: 'Invalid email or password' });
      }
    } else {
      // Email non trovata
      res.status(401).json({ error: 'Invalid email or password' });
    }
  }
  catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// Endpoint per l'invio del codice di verifica email
app.post('/api/email/send-code', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email obbligatoria' });
  }
  try {
    // 1. Controlla se l'email è già in uso
    const userCheck = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userCheck.rows.length > 0) {
      return res.status(409).json({ error: 'Email già in uso' });
    }

    // 2. Genera un codice a 6 cifre casuale
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // 3. Upsert nella tabella email_verifications
    await pool.query(`
      INSERT INTO email_verifications (email, code, verified, created_at)
      VALUES ($1, $2, FALSE, NOW())
      ON CONFLICT (email)
      DO UPDATE SET code = $2, verified = FALSE, created_at = NOW()
    `, [email, code]);

    // 4. Stampa il codice nei log del server per il test manuale
    console.log('\n==================================================');
    console.log(`[EMAIL VERIFICATION] Codice per ${email}: ${code}`);
    console.log('==================================================\n');

    // 5. Invia l'email se configurata (preferisci Resend se presente per aggirare blocco SMTP)
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #ff5100; text-align: center;">Benvenuto su ABCStories!</h2>
        <p>Grazie per aver scelto la nostra piattaforma. Per completare la registrazione, inserisci il seguente codice di verifica a 6 cifre:</p>
        <div style="text-align: center; margin: 30px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #333; background-color: #f7f7f7; padding: 10px 20px; border-radius: 4px; border: 1px dashed #ccc;">${code}</span>
        </div>
        <p style="color: #555;">Il codice scadrà tra 15 minuti. Se non hai richiesto tu questo codice, ignora questa email.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #888; text-align: center;">ABCStories Staff</p>
      </div>
    `;

    if (process.env.BREVO_API_KEY) {
      try {
        const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': process.env.BREVO_API_KEY,
            'content-type': 'application/json',
            'accept': 'application/json'
          },
          body: JSON.stringify({
            sender: { name: 'ABCStories', email: process.env.BREVO_USER || 'lucaascone93@gmail.com' },
            to: [{ email: email }],
            subject: 'Codice di Verifica ABCStories',
            htmlContent: htmlContent
          })
        });

        if (!brevoRes.ok) {
          const errData = await brevoRes.json().catch(() => ({}));
          throw new Error(`Brevo API Error: ${brevoRes.status} ${JSON.stringify(errData)}`);
        }

        res.json({ success: true, devMode: false });
      } catch (err) {
        console.error('[BREVO API ERROR] Errore durante l\'invio con Brevo API:', err);
        res.status(500).json({ error: 'Impossibile inviare l\'email di verifica via Brevo' });
      }
    } else if (transporter) {
      const mailOptions = {
        from: `"ABCStories" <${process.env.SMTP_USER || process.env.BREVO_USER}>`,
        to: email,
        subject: 'Codice di Verifica ABCStories',
        text: `Il tuo codice di verifica per completare la registrazione su ABCStories è: ${code}. Questo codice è valido per 15 minuti.`,
        html: htmlContent
      };

      try {
        await transporter.sendMail(mailOptions);
        res.json({ success: true, devMode: false });
      } catch (err) {
        console.error('[MAIL ERROR] Errore durante l\'invio dell\'email:', err);
        res.status(500).json({ error: 'Impossibile inviare l\'email di verifica' });
      }
    } else if (process.env.RESEND_API_KEY) {
      try {
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: process.env.RESEND_FROM || 'onboarding@resend.dev',
            to: email,
            subject: 'Codice di Verifica ABCStories',
            html: htmlContent
          })
        });

        if (!resendRes.ok) {
          const errData = await resendRes.json().catch(() => ({}));
          throw new Error(`Resend API Error: ${resendRes.status} ${JSON.stringify(errData)}`);
        }

        res.json({ success: true, devMode: false });
      } catch (err) {
        console.error('[RESEND ERROR] Errore durante l\'invio con Resend:', err);
        res.status(500).json({ error: 'Impossibile inviare l\'email di verifica via Resend' });
      }
    } else {
      res.json({ success: true, devMode: true, code: code });
    }
  } catch (error) {
    console.error('Errore in send-code:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Endpoint per verificare il codice inserito dall'utente
app.post('/api/email/verify-code', async (req, res) => {
  const { email, code } = req.body;
  const timerLabel = `[VERIFY-CODE] Tempo totale per ${email}`;
  console.time(timerLabel);
  if (!email || !code) {
    console.timeEnd(timerLabel);
    return res.status(400).json({ error: 'Email e codice obbligatori' });
  }
  try {
    console.log(`[VERIFY-CODE] Avvio query SELECT per verificare codice di ${email}`);
    const result = await pool.query('SELECT code FROM email_verifications WHERE email = $1', [email]);
    console.log(`[VERIFY-CODE] Query SELECT completata per ${email}`);

    if (result.rows.length === 0 || result.rows[0].code !== code) {
      console.log(`[VERIFY-CODE] Codice errato o mancante per ${email}`);
      console.timeEnd(timerLabel);
      return res.status(400).json({ error: 'Codice non valido o scaduto' });
    }

    console.log(`[VERIFY-CODE] Avvio query UPDATE per impostare verified = true per ${email}`);
    await pool.query('UPDATE email_verifications SET verified = TRUE WHERE email = $1', [email]);
    console.log(`[VERIFY-CODE] Query UPDATE completata per ${email}`);

    console.timeEnd(timerLabel);
    res.json({ success: true });
  } catch (error) {
    console.error('Errore in verify-code:', error);
    console.timeEnd(timerLabel);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/user/register', async (req, res) => {
  const { email, username, password } = req.body;
  try {
    // 1. Controlla prima che l'email sia stata verificata
    const verification = await pool.query(
      'SELECT verified FROM email_verifications WHERE email = $1',
      [email]
    );
    if (verification.rows.length === 0 || !verification.rows[0].verified) {
      return res.status(400).json({ error: 'Email non verificata. Completa la verifica prima di registrarti.' });
    }

    // 2. Controlla se email o username esistono già
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email o username già in uso' });
    }

    // Controlla requisiti minimi di sicurezza per la password
    if (
      !password ||
      password.length < 8 ||
      !/[A-Z]/.test(password) ||
      !/[a-z]/.test(password) ||
      !/[0-9]/.test(password) ||
      !/[\W_]/.test(password)
    ) {
      return res.status(400).json({
        error: 'La password non rispetta i requisiti minimi di sicurezza (almeno 8 caratteri, una maiuscola, una minuscola, un numero e un carattere speciale).'
      });
    }

    // Genera esplicitamente il salt e poi l'hash della password prima di salvarla
    const salt = await bcrypt.genSalt(SALT_ROUNDS);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Salva l'hash nel database inserendo l'avatar di default
    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash, avatar_url) VALUES ($1, $2, $3, $4) RETURNING id, username, email, avatar_url',
      [username, email, hashedPassword, 'assets/Pippi/pippiIniziale.png']
    );

    // 3. Elimina il record di verifica dell'email
    await pool.query('DELETE FROM email_verifications WHERE email = $1', [email]);

    res.status(201).json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// ═══════════════ USER SETTINGS & RECOMMENDED ═══════════════

// Ottieni le storie raccomandate da un utente
app.get('/api/user/:userId/recommended', async (req, res) => {
  try {
    const userRes = await pool.query('SELECT recommended_story_ids FROM users WHERE id = $1', [req.params.userId]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'Utente non trovato' });

    const storyIds = userRes.rows[0].recommended_story_ids || [];
    if (storyIds.length === 0) return res.json([]);

    // Recupera i dettagli delle storie raccomandate
    const storiesRes = await pool.query(`
      SELECT s.id, s.author_id, s.title, s.description, s.genre, s.image_url, s.is_18_plus, s.completion_status,
             (SELECT COUNT(*) FROM story_views WHERE story_id = s.id) AS readers_count,
             (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE story_id = s.id) AS rating,
             s.created_at,
             u.username AS author_name
      FROM stories s
      LEFT JOIN users u ON u.id = s.author_id
      WHERE s.id = ANY($1) AND s.status = 'published'
    `, [storyIds]);

    res.json(storiesRes.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Aggiorna le storie raccomandate da un utente
app.put('/api/user/:userId/recommended', async (req, res) => {
  const { storyIds } = req.body;
  if (!Array.isArray(storyIds)) return res.status(400).json({ error: 'storyIds deve essere un array' });

  try {
    await pool.query('UPDATE users SET recommended_story_ids = $1 WHERE id = $2', [storyIds, req.params.userId]);
    res.json({ success: true });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// ═══════════════ LIKES ═══════════════

// Toggle like (inserisce se non esiste, elimina se esiste)
app.post('/api/likes/toggle', async (req, res) => {
  const { user_id, story_id } = req.body;
  try {
    const exists = await pool.query(
      'SELECT 1 FROM story_likes WHERE user_id = $1 AND story_id = $2',
      [user_id, story_id]
    );
    if (exists.rows.length > 0) {
      await pool.query('DELETE FROM story_likes WHERE user_id = $1 AND story_id = $2', [user_id, story_id]);
      res.json({ liked: false });
    } else {
      await pool.query('INSERT INTO story_likes (user_id, story_id) VALUES ($1, $2)', [user_id, story_id]);
      
      // Trigger story like notification to the author of the story
      const storyRes = await pool.query('SELECT author_id, title FROM stories WHERE id = $1', [story_id]);
      if (storyRes.rows.length > 0) {
        const story = storyRes.rows[0];
        if (story.author_id !== user_id) {
          const checkPref = await pool.query('SELECT notifiche_storie_like FROM users WHERE id = $1', [story.author_id]);
          if (checkPref.rows.length > 0 && checkPref.rows[0].notifiche_storie_like !== false) {
            const senderRes = await pool.query('SELECT username FROM users WHERE id = $1', [user_id]);
            const senderUsername = senderRes.rows.length > 0 ? senderRes.rows[0].username : 'Qualcuno';
            const message = `${senderUsername} ha messo mi piace alla tua storia "${story.title}"`;
            await pool.query(`
              INSERT INTO notifications (user_id, sender_id, story_id, type, message)
              VALUES ($1, $2, $3, $4, $5)
            `, [story.author_id, user_id, story_id, 'story_like', message]);
          }
        }
      }

      res.json({ liked: true });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Restituisce gli ID delle storie liked dall'utente
app.get('/api/likes/:userId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT story_id FROM story_likes WHERE user_id = $1',
      [req.params.userId]
    );
    res.json(result.rows.map(r => r.story_id));
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Recupera le recensioni di una specifica storia
app.get('/api/stories/:storyId/reviews', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.content, r.rating, u.username as name
       FROM reviews r
       JOIN users u ON r.author_id = u.id
       WHERE r.story_id = $1`,
      [req.params.storyId]
    );
    res.json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Restituisce le storie liked con tutti i dettagli (per il profilo utente)
app.get('/api/likes/:userId/stories', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, 
              (SELECT COUNT(*) FROM story_views WHERE story_id = s.id) AS readers_count,
              (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE story_id = s.id) AS rating,
              u.username AS author_name, sl.created_at AS liked_at
       FROM story_likes sl
       JOIN stories s ON s.id = sl.story_id
       LEFT JOIN users u ON u.id = s.author_id
       WHERE sl.user_id = $1
       ORDER BY sl.created_at DESC`,
      [req.params.userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// ═══════════════ SEARCH ═══════════════

app.get('/api/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ stories: [], authors: [], genres: [] });
  try {
    const queryStr = `%${q}%`;

    // 1. Search stories
    const storiesRes = await pool.query(`
      SELECT s.id, s.author_id, s.title, s.description, s.genre, s.image_url, s.is_18_plus, s.completion_status, s.created_at,
             u.username AS author_name,
             (SELECT COUNT(*) FROM story_views WHERE story_id = s.id) AS readers_count,
             (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE story_id = s.id) AS rating
      FROM stories s
      LEFT JOIN users u ON u.id = s.author_id
      WHERE (s.title ILIKE $1 OR s.description ILIKE $1 OR s.genre ILIKE $1)
        AND s.status = 'published'
        AND s.title IS NOT NULL
        AND s.title != ''
    `, [queryStr]);

    // 2. Search authors
    const authorsRes = await pool.query(`
      SELECT id, username, avatar_url, bio, location,
             (SELECT COUNT(*) FROM stories WHERE author_id = users.id AND status = 'published') AS stories_count,
             (SELECT COUNT(*) FROM follows WHERE followed_id = users.id) AS followers_count
      FROM users
      WHERE username ILIKE $1
    `, [queryStr]);

    // 3. Search genres matching the query
    const genresList = ['horror', 'western', 'fantasy', 'thriller', 'romanzo', 'storico', 'fantascienza', 'avventura', 'biografia'];
    const matchedGenres = genresList.filter(g => g.toLowerCase().includes(q.toLowerCase()));

    res.json({
      stories: storiesRes.rows,
      authors: authorsRes.rows,
      genres: matchedGenres
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ═══════════════ BOOKMARKS ═══════════════


// Toggle bookmark (inserisce se non esiste, elimina se esiste)
app.post('/api/bookmarks/toggle', async (req, res) => {
  const { user_id, story_id } = req.body;
  try {
    const exists = await pool.query(
      'SELECT 1 FROM story_bookmarks WHERE user_id = $1 AND story_id = $2',
      [user_id, story_id]
    );
    if (exists.rows.length > 0) {
      await pool.query('DELETE FROM story_bookmarks WHERE user_id = $1 AND story_id = $2', [user_id, story_id]);
      res.json({ bookmarked: false });
    } else {
      await pool.query('INSERT INTO story_bookmarks (user_id, story_id) VALUES ($1, $2)', [user_id, story_id]);
      
      // Trigger story bookmark notification to the author of the story
      const storyRes = await pool.query('SELECT author_id, title FROM stories WHERE id = $1', [story_id]);
      if (storyRes.rows.length > 0) {
        const story = storyRes.rows[0];
        if (story.author_id !== user_id) {
          const checkPref = await pool.query('SELECT notifiche_storie_preferiti FROM users WHERE id = $1', [story.author_id]);
          if (checkPref.rows.length > 0 && checkPref.rows[0].notifiche_storie_preferiti !== false) {
            const senderRes = await pool.query('SELECT username FROM users WHERE id = $1', [user_id]);
            const senderUsername = senderRes.rows.length > 0 ? senderRes.rows[0].username : 'Qualcuno';
            const message = `${senderUsername} ha aggiunto la tua storia "${story.title}" ai preferiti`;
            await pool.query(`
              INSERT INTO notifications (user_id, sender_id, story_id, type, message)
              VALUES ($1, $2, $3, $4, $5)
            `, [story.author_id, user_id, story_id, 'story_bookmark', message]);
          }
        }
      }

      res.json({ bookmarked: true });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Restituisce gli ID delle storie bookmarked dall'utente
app.get('/api/bookmarks/:userId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT story_id FROM story_bookmarks WHERE user_id = $1',
      [req.params.userId]
    );
    res.json(result.rows.map(r => r.story_id));
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Restituisce le storie bookmarked con tutti i dettagli (per il profilo utente)
app.get('/api/bookmarks/:userId/stories', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, 
              (SELECT COUNT(*) FROM story_views WHERE story_id = s.id) AS readers_count,
              (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE story_id = s.id) AS rating,
              u.username AS author_name, sb.created_at AS bookmarked_at
       FROM story_bookmarks sb
       JOIN stories s ON s.id = sb.story_id
       LEFT JOIN users u ON u.id = s.author_id
       WHERE sb.user_id = $1
       ORDER BY sb.created_at DESC`,
      [req.params.userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// ═══════════════ COMMENTS ═══════════════

// Ottieni commenti e risposte di una storia, incluso il conteggio dei like e lo stato like dell'utente se passato
app.get('/api/stories/:storyId/comments', async (req, res) => {
  const userId = req.query.userId || null;
  try {
    // 1. Prendi tutti i commenti
    const commentsRes = await pool.query(`
      SELECT c.id, c.content as text, c.created_at, 
             u.id as author_id, u.username as author_name, u.email as author_handle, u.avatar_url,
             (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id) as likes_count
             ${userId ? `, EXISTS(SELECT 1 FROM comment_likes cl WHERE cl.comment_id = c.id AND cl.user_id = $2) as user_liked` : ''}
      FROM comments c
      JOIN users u ON u.id = c.author_id
      WHERE c.story_id = $1
      ORDER BY c.created_at DESC
    `, userId ? [req.params.storyId, userId] : [req.params.storyId]);

    const comments = commentsRes.rows;

    // 2. Prendi tutte le risposte per questi commenti
    if (comments.length > 0) {
      const commentIds = comments.map(c => c.id);
      const repliesRes = await pool.query(`
        SELECT r.id, r.comment_id, r.content as text, r.created_at,
               u.id as author_id, u.username as author_name, u.email as author_handle, u.avatar_url,
               (SELECT COUNT(*) FROM reply_likes rl WHERE rl.reply_id = r.id) as likes_count
               ${userId ? `, EXISTS(SELECT 1 FROM reply_likes rl WHERE rl.reply_id = r.id AND rl.user_id = $2) as user_liked` : ''}
        FROM comment_replies r
        JOIN users u ON u.id = r.author_id
        WHERE r.comment_id = ANY($1)
        ORDER BY r.created_at ASC
      `, userId ? [commentIds, userId] : [commentIds]);

      const replies = repliesRes.rows;

      // Associa le risposte ai commenti
      comments.forEach(c => {
        c.replies = replies.filter(r => r.comment_id === c.id);
      });
    }

    res.json(comments);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Aggiungi commento
app.post('/api/stories/:storyId/comments', async (req, res) => {
  const { author_id, content } = req.body;
  try {
    const result = await pool.query(`
      INSERT INTO comments (story_id, author_id, content) 
      VALUES ($1, $2, $3) RETURNING id, content, created_at
    `, [req.params.storyId, author_id, content]);

    // Ritorna il commento appena creato
    const userRes = await pool.query('SELECT username as author_name, email as author_handle, avatar_url FROM users WHERE id = $1', [author_id]);
    res.json({ ...result.rows[0], ...userRes.rows[0], likes_count: 0, user_liked: false, replies: [] });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Aggiungi risposta
app.post('/api/comments/:commentId/replies', async (req, res) => {
  const { author_id, content } = req.body;
  try {
    const result = await pool.query(`
      INSERT INTO comment_replies (comment_id, author_id, content) 
      VALUES ($1, $2, $3) RETURNING id, comment_id, content, created_at
    `, [req.params.commentId, author_id, content]);

    const userRes = await pool.query('SELECT username as author_name, email as author_handle, avatar_url FROM users WHERE id = $1', [author_id]);
    
    // Trigger reply notification!
    const commentRes = await pool.query('SELECT author_id, story_id FROM comments WHERE id = $1', [req.params.commentId]);
    if (commentRes.rows.length > 0) {
      const parentComment = commentRes.rows[0];
      if (parentComment.author_id !== author_id) {
        const checkPref = await pool.query('SELECT notifiche_risposte_commenti FROM users WHERE id = $1', [parentComment.author_id]);
        if (checkPref.rows.length > 0 && checkPref.rows[0].notifiche_risposte_commenti !== false) {
          const senderUsername = userRes.rows[0].author_name;
          const storyRes = await pool.query('SELECT title FROM stories WHERE id = $1', [parentComment.story_id]);
          const storyTitle = storyRes.rows.length > 0 ? storyRes.rows[0].title : '';
          const message = `${senderUsername} ha risposto al tuo commento nella storia "${storyTitle}"`;
          await pool.query(`
            INSERT INTO notifications (user_id, sender_id, story_id, type, message)
            VALUES ($1, $2, $3, $4, $5)
          `, [parentComment.author_id, author_id, parentComment.story_id, 'comment_reply', message]);
        }
      }
    }

    res.json({ ...result.rows[0], ...userRes.rows[0], likes_count: 0, user_liked: false });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Toggle like commento
app.post('/api/comments/:commentId/like', async (req, res) => {
  const { user_id } = req.body;
  try {
    const exists = await pool.query('SELECT 1 FROM comment_likes WHERE user_id = $1 AND comment_id = $2', [user_id, req.params.commentId]);
    if (exists.rows.length > 0) {
      await pool.query('DELETE FROM comment_likes WHERE user_id = $1 AND comment_id = $2', [user_id, req.params.commentId]);
      res.json({ liked: false });
    } else {
      await pool.query('INSERT INTO comment_likes (user_id, comment_id) VALUES ($1, $2)', [user_id, req.params.commentId]);
      
      // Trigger comment like notification
      const commentRes = await pool.query('SELECT author_id, story_id FROM comments WHERE id = $1', [req.params.commentId]);
      if (commentRes.rows.length > 0) {
        const comment = commentRes.rows[0];
        if (comment.author_id !== user_id) {
          const checkPref = await pool.query('SELECT notifiche_like_commenti FROM users WHERE id = $1', [comment.author_id]);
          if (checkPref.rows.length > 0 && checkPref.rows[0].notifiche_like_commenti !== false) {
            const senderRes = await pool.query('SELECT username FROM users WHERE id = $1', [user_id]);
            const senderUsername = senderRes.rows.length > 0 ? senderRes.rows[0].username : 'Qualcuno';
            const storyRes = await pool.query('SELECT title FROM stories WHERE id = $1', [comment.story_id]);
            const storyTitle = storyRes.rows.length > 0 ? storyRes.rows[0].title : '';
            const message = `${senderUsername} ha messo mi piace al tuo commento nella storia "${storyTitle}"`;
            await pool.query(`
              INSERT INTO notifications (user_id, sender_id, story_id, type, message)
              VALUES ($1, $2, $3, $4, $5)
            `, [comment.author_id, user_id, comment.story_id, 'comment_like', message]);
          }
        }
      }

      res.json({ liked: true });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Toggle like risposta
app.post('/api/comments/replies/:replyId/like', async (req, res) => {
  const { user_id } = req.body;
  try {
    const exists = await pool.query('SELECT 1 FROM reply_likes WHERE user_id = $1 AND reply_id = $2', [user_id, req.params.replyId]);
    if (exists.rows.length > 0) {
      await pool.query('DELETE FROM reply_likes WHERE user_id = $1 AND reply_id = $2', [user_id, req.params.replyId]);
      res.json({ liked: false });
    } else {
      await pool.query('INSERT INTO reply_likes (user_id, reply_id) VALUES ($1, $2)', [user_id, req.params.replyId]);
      
      // Trigger reply like notification
      const replyRes = await pool.query(`
        SELECT r.author_id, c.story_id 
        FROM comment_replies r 
        JOIN comments c ON c.id = r.comment_id 
        WHERE r.id = $1
      `, [req.params.replyId]);
      if (replyRes.rows.length > 0) {
        const reply = replyRes.rows[0];
        if (reply.author_id !== user_id) {
          const checkPref = await pool.query('SELECT notifiche_like_commenti FROM users WHERE id = $1', [reply.author_id]);
          if (checkPref.rows.length > 0 && checkPref.rows[0].notifiche_like_commenti !== false) {
            const senderRes = await pool.query('SELECT username FROM users WHERE id = $1', [user_id]);
            const senderUsername = senderRes.rows.length > 0 ? senderRes.rows[0].username : 'Qualcuno';
            const storyRes = await pool.query('SELECT title FROM stories WHERE id = $1', [reply.story_id]);
            const storyTitle = storyRes.rows.length > 0 ? storyRes.rows[0].title : '';
            const message = `${senderUsername} ha messo mi piace alla tua risposta nella storia "${storyTitle}"`;
            await pool.query(`
              INSERT INTO notifications (user_id, sender_id, story_id, type, message)
              VALUES ($1, $2, $3, $4, $5)
            `, [reply.author_id, user_id, reply.story_id, 'comment_like', message]);
          }
        }
      }

      res.json({ liked: true });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// ═══════════════ STORIES ═══════════════

// Tutte le storie
app.get('/api/stories', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.id, s.author_id, s.title, s.description, s.genre, s.image_url, s.is_18_plus, s.completion_status,
              (SELECT COUNT(*) FROM story_views WHERE story_id = s.id) AS readers_count,
              (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE story_id = s.id) AS rating,
              s.created_at,
              u.username AS author_name
       FROM stories s
       LEFT JOIN users u ON u.id = s.author_id
       WHERE s.status = 'published'
       ORDER BY rating DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ── Route specifiche PRIMA di :id (altrimenti Express cattura come id) ──

// Storie popolari (più visualizzazioni totali)
app.get('/api/stories/popular', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.id, s.author_id, s.title, s.description, s.genre, s.image_url, s.is_18_plus, s.completion_status,
             (SELECT COUNT(*) FROM story_views WHERE story_id = s.id) AS readers_count,
             (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE story_id = s.id) AS rating,
             s.created_at,
             u.username AS author_name,
             COUNT(sv.id) AS view_count
      FROM stories s
      LEFT JOIN users u ON u.id = s.author_id
      LEFT JOIN story_views sv ON sv.story_id = s.id
      WHERE s.status = 'published'
      GROUP BY s.id, u.username
      ORDER BY view_count DESC, rating DESC
      LIMIT 20
    `);
    res.json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Storie di tendenza (i libri più visti in assoluto tra quelli letti negli ultimi 7 giorni)
app.get('/api/stories/trending', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.id, s.author_id, s.title, s.description, s.genre, s.image_url, s.is_18_plus, s.completion_status,
             (SELECT COUNT(*) FROM story_views WHERE story_id = s.id) AS readers_count,
             (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE story_id = s.id) AS rating,
             s.created_at,
             u.username AS author_name
      FROM stories s
      LEFT JOIN users u ON u.id = s.author_id
      WHERE s.status = 'published'
        AND EXISTS (
          SELECT 1 FROM story_views
          WHERE story_id = s.id AND viewed_at >= NOW() - INTERVAL '7 days'
        )
      ORDER BY readers_count DESC, rating DESC
      LIMIT 15
    `);
    res.json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Storie consigliate in base ai preferiti dell'utente (likes e bookmarks)
app.get('/api/stories/favorites-based/:userId', async (req, res) => {
  const { userId } = req.params;
  const isUuid = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  try {
    let favoritesRes = { rows: [] };
    if (isUuid(userId)) {
      favoritesRes = await pool.query(`
        SELECT story_id FROM story_likes WHERE user_id = $1
        UNION
        SELECT story_id FROM story_bookmarks WHERE user_id = $1
      `, [userId]);
    }
    
    let targetGenres = [];
    let excludeStoryIds = [];
    
    if (favoritesRes.rows.length > 0) {
      excludeStoryIds = favoritesRes.rows.map(r => r.story_id);
      const genresRes = await pool.query(`
        SELECT DISTINCT genre FROM stories WHERE id = ANY($1)
      `, [excludeStoryIds]);
      
      genresRes.rows.forEach(r => {
        if (r.genre) {
          const parts = r.genre.split(',').map(g => g.trim());
          targetGenres.push(...parts);
        }
      });
    }
    
    targetGenres = [...new Set(targetGenres)].filter(Boolean);
    
    let query = '';
    let params = [];
    
    if (targetGenres.length > 0) {
      query = `
        SELECT s.id, s.author_id, s.title, s.description, s.genre, s.image_url, s.is_18_plus, s.completion_status,
               (SELECT COUNT(*) FROM story_views WHERE story_id = s.id) AS readers_count,
               (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE story_id = s.id) AS rating,
               s.created_at,
               u.username AS author_name,
               COUNT(sv.id) AS view_count
        FROM stories s
        LEFT JOIN users u ON u.id = s.author_id
        LEFT JOIN story_views sv ON sv.story_id = s.id
        WHERE s.status = 'published'
          AND s.id != ALL($1)
          AND (${targetGenres.map((_, idx) => `s.genre ILIKE $${idx + 2}`).join(' OR ')})
        GROUP BY s.id, u.username
        ORDER BY view_count DESC, rating DESC
        LIMIT 20
      `;
      params = [excludeStoryIds, ...targetGenres.map(g => `%${g}%`)];
    } else {
      const topPopularRes = await pool.query(`
        SELECT s.id, s.genre, COUNT(sv.id) AS view_count
        FROM stories s
        LEFT JOIN story_views sv ON sv.story_id = s.id
        WHERE s.status = 'published'
        GROUP BY s.id
        ORDER BY view_count DESC
        LIMIT 5
      `);
      
      const popGenres = [];
      topPopularRes.rows.forEach(r => {
        if (r.genre) {
          popGenres.push(...r.genre.split(',').map(g => g.trim()));
        }
      });
      const uniquePopGenres = [...new Set(popGenres)].filter(Boolean);
      
      if (uniquePopGenres.length > 0) {
        query = `
          SELECT s.id, s.author_id, s.title, s.description, s.genre, s.image_url, s.is_18_plus, s.completion_status,
                 (SELECT COUNT(*) FROM story_views WHERE story_id = s.id) AS readers_count,
                 (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE story_id = s.id) AS rating,
                 s.created_at,
                 u.username AS author_name,
                 COUNT(sv.id) AS view_count
          FROM stories s
          LEFT JOIN users u ON u.id = s.author_id
          LEFT JOIN story_views sv ON sv.story_id = s.id
          WHERE s.status = 'published'
            AND (${uniquePopGenres.map((_, idx) => `s.genre ILIKE $${idx + 1}`).join(' OR ')})
          GROUP BY s.id, u.username
          ORDER BY view_count DESC, rating DESC
          LIMIT 20
        `;
        params = uniquePopGenres.map(g => `%${g}%`);
      } else {
        query = `
          SELECT s.id, s.author_id, s.title, s.description, s.genre, s.image_url, s.is_18_plus, s.completion_status,
                 (SELECT COUNT(*) FROM story_views WHERE story_id = s.id) AS readers_count,
                 (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE story_id = s.id) AS rating,
                 s.created_at,
                 u.username AS author_name,
                 COUNT(sv.id) AS view_count
          FROM stories s
          LEFT JOIN users u ON u.id = s.author_id
          LEFT JOIN story_views sv ON sv.story_id = s.id
          WHERE s.status = 'published'
          GROUP BY s.id, u.username
          ORDER BY view_count DESC, rating DESC
          LIMIT 20
        `;
        params = [];
      }
    }
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Storie consigliate in base a cosa l'utente sta leggendo (o generi più visti)
app.get('/api/stories/recommended/:userId', async (req, res) => {
  const { userId } = req.params;
  const isUuid = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  try {
    let readingRes = { rows: [] };
    if (isUuid(userId)) {
      readingRes = await pool.query(`
        SELECT DISTINCT s.id, s.genre
        FROM reading_progress rp
        JOIN chapters c ON c.id = rp.chapter_id
        JOIN stories s ON s.id = c.story_id
        WHERE rp.user_id = $1
      `, [userId]);
    }
    
    let targetGenres = [];
    let excludeStoryIds = [];
    
    if (readingRes.rows.length > 0) {
      excludeStoryIds = readingRes.rows.map(r => r.id);
      readingRes.rows.forEach(r => {
        if (r.genre) {
          targetGenres.push(...r.genre.split(',').map(g => g.trim()));
        }
      });
    }
    
    targetGenres = [...new Set(targetGenres)].filter(Boolean);
    
    if (isUuid(userId) && targetGenres.length === 0) {
      const viewedGenresRes = await pool.query(`
        SELECT s.genre, COUNT(sv.id) as view_count
        FROM story_views sv
        JOIN stories s ON s.id = sv.story_id
        WHERE sv.user_id = $1 AND s.genre IS NOT NULL
        GROUP BY s.genre
        ORDER BY view_count DESC
        LIMIT 5
      `, [userId]);
      
      viewedGenresRes.rows.forEach(r => {
        targetGenres.push(...r.genre.split(',').map(g => g.trim()));
      });
      targetGenres = [...new Set(targetGenres)].filter(Boolean);
    }
    
    let query = '';
    let params = [];
    
    if (targetGenres.length > 0) {
      query = `
        SELECT s.id, s.author_id, s.title, s.description, s.genre, s.image_url, s.is_18_plus, s.completion_status,
               (SELECT COUNT(*) FROM story_views WHERE story_id = s.id) AS readers_count,
               (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE story_id = s.id) AS rating,
               s.created_at,
               u.username AS author_name,
               COUNT(sv.id) AS view_count
        FROM stories s
        LEFT JOIN users u ON u.id = s.author_id
        LEFT JOIN story_views sv ON sv.story_id = s.id
        WHERE s.status = 'published'
          ${excludeStoryIds.length > 0 ? 'AND s.id != ALL($1)' : ''}
          AND (${targetGenres.map((_, idx) => `s.genre ILIKE $${excludeStoryIds.length > 0 ? idx + 2 : idx + 1}`).join(' OR ')})
        GROUP BY s.id, u.username
        ORDER BY view_count DESC, rating DESC
        LIMIT 20
      `;
      if (excludeStoryIds.length > 0) {
        params = [excludeStoryIds, ...targetGenres.map(g => `%${g}%`)];
      } else {
        params = targetGenres.map(g => `%${g}%`);
      }
    } else {
      const topGenresRes = await pool.query(`
        SELECT genre, COUNT(*) as story_count
        FROM stories
        WHERE status = 'published' AND genre IS NOT NULL
        GROUP BY genre
        ORDER BY story_count DESC
        LIMIT 3
      `);
      const fallbackGenres = [];
      topGenresRes.rows.forEach(r => {
        fallbackGenres.push(...r.genre.split(',').map(g => g.trim()));
      });
      const uniqueFallback = [...new Set(fallbackGenres)].filter(Boolean);
      
      query = `
        SELECT s.id, s.author_id, s.title, s.description, s.genre, s.image_url, s.is_18_plus, s.completion_status,
               (SELECT COUNT(*) FROM story_views WHERE story_id = s.id) AS readers_count,
               (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE story_id = s.id) AS rating,
               s.created_at,
               u.username AS author_name,
               COUNT(sv.id) AS view_count
        FROM stories s
        LEFT JOIN users u ON u.id = s.author_id
        LEFT JOIN story_views sv ON sv.story_id = s.id
        WHERE s.status = 'published'
          ${uniqueFallback.length > 0 ? `AND (${uniqueFallback.map((_, idx) => `s.genre ILIKE $${idx + 1}`).join(' OR ')})` : ''}
        GROUP BY s.id, u.username
        ORDER BY view_count DESC, rating DESC
        LIMIT 20
      `;
      params = uniqueFallback.map(g => `%${g}%`);
    }
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Storie scritte da autori iscritti da meno di 2 mesi
app.get('/api/stories/new-talents', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.id, s.author_id, s.title, s.description, s.genre, s.image_url, s.is_18_plus, s.completion_status,
             (SELECT COUNT(*) FROM story_views WHERE story_id = s.id) AS readers_count,
             (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE story_id = s.id) AS rating,
             s.created_at,
             u.username AS author_name
      FROM stories s
      JOIN users u ON u.id = s.author_id
      WHERE s.status = 'published'
        AND u.created_at >= NOW() - INTERVAL '2 months'
      ORDER BY s.created_at DESC
      LIMIT 20
    `);
    res.json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Storie molto brevi (con da 1 a 5 capitoli)
app.get('/api/stories/quick-reads', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.id, s.author_id, s.title, s.description, s.genre, s.image_url, s.is_18_plus, s.completion_status,
             (SELECT COUNT(*) FROM story_views WHERE story_id = s.id) AS readers_count,
             (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE story_id = s.id) AS rating,
             s.created_at,
             u.username AS author_name,
             COUNT(c.id) AS chapters_count
      FROM stories s
      LEFT JOIN users u ON u.id = s.author_id
      LEFT JOIN chapters c ON c.story_id = s.id AND c.status = 'published'
      WHERE s.status = 'published'
      GROUP BY s.id, u.username
      HAVING COUNT(c.id) > 0 AND COUNT(c.id) <= 5
      ORDER BY chapters_count ASC, rating DESC, s.created_at DESC
      LIMIT 20
    `);
    res.json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Artisti reali dal database (scrittori con storie pubblicate) ordinati per followers
app.get('/api/authors/popular', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.username AS name, u.avatar_url AS img,
             (SELECT COUNT(*) FROM follows WHERE followed_id = u.id) AS followers
      FROM users u
      WHERE EXISTS (
        SELECT 1 FROM stories WHERE author_id = u.id AND status = 'published'
      )
      ORDER BY followers DESC
      LIMIT 20
    `);
    res.json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Storie in base al completion_status
app.get('/api/stories/completion/:status', async (req, res) => {
  const { status } = req.params;
  try {
    const result = await pool.query(`
      SELECT s.id, s.author_id, s.title, s.description, s.genre, s.image_url, s.is_18_plus, s.completion_status,
             (SELECT COUNT(*) FROM story_views WHERE story_id = s.id) AS readers_count,
             (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE story_id = s.id) AS rating,
             s.created_at,
             u.username AS author_name
      FROM stories s
      LEFT JOIN users u ON u.id = s.author_id
      WHERE s.status = 'published' AND s.completion_status = $1
      ORDER BY rating DESC, s.created_at DESC
      LIMIT 20
    `, [status]);
    res.json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Storie con contenuti 18+ (is_18_plus = TRUE)
app.get('/api/stories/nsfw', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.id, s.author_id, s.title, s.description, s.genre, s.image_url, s.is_18_plus, s.completion_status,
             (SELECT COUNT(*) FROM story_views WHERE story_id = s.id) AS readers_count,
             (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE story_id = s.id) AS rating,
             s.created_at,
             u.username AS author_name
      FROM stories s
      LEFT JOIN users u ON u.id = s.author_id
      WHERE s.status = 'published' AND s.is_18_plus = TRUE
      ORDER BY rating DESC, s.created_at DESC
      LIMIT 20
    `);
    res.json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// Storie simili (Potrebbero piacerti anche)
app.get('/api/stories/similar/:storyId', async (req, res) => {
  try {
    // Prima otteniamo il genere della storia corrente
    const storyRes = await pool.query('SELECT genre FROM stories WHERE id = $1', [req.params.storyId]);
    if (storyRes.rows.length === 0) return res.json([]);

    const genre = storyRes.rows[0].genre;
    if (!genre) return res.json([]);

    // Troviamo storie simili per genere, escludendo quella corrente, ordinate per popolarità
    const result = await pool.query(`
      SELECT s.id, s.author_id, s.title, s.description, s.genre, s.image_url, s.is_18_plus, s.completion_status,
             (SELECT COUNT(*) FROM story_views WHERE story_id = s.id) AS readers_count,
             (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE story_id = s.id) AS rating,
             s.created_at,
             u.username AS author_name,
             COUNT(sv.id) AS view_count
      FROM stories s
      LEFT JOIN users u ON u.id = s.author_id
      LEFT JOIN story_views sv ON sv.story_id = s.id
      WHERE s.status = 'published' 
        AND s.id != $1 
        AND s.genre ILIKE $2
      GROUP BY s.id, u.username
      ORDER BY view_count DESC, rating DESC
      LIMIT 50
    `, [req.params.storyId, `%${genre}%`]);

    res.json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Storie filtrate per genere
app.get('/api/stories/genre/:genre', async (req, res) => {
  try {
    const genre = `%${req.params.genre}%`;
    const result = await pool.query(`
      SELECT s.id, s.author_id, s.title, s.description, s.genre, s.image_url, s.is_18_plus, s.completion_status,
             (SELECT COUNT(*) FROM story_views WHERE story_id = s.id) AS readers_count,
             (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE story_id = s.id) AS rating,
             s.created_at,
             u.username AS author_name
      FROM stories s
      LEFT JOIN users u ON u.id = s.author_id
      WHERE s.genre ILIKE $1 AND s.status = 'published'
      ORDER BY rating DESC
    `, [genre]);
    res.json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Storie con lettura incompleta (Riprendi a leggere)
app.get('/api/stories/continue/:userId', async (req, res) => {
  try {
    const result = await pool.query(`
      WITH LastRead AS (
        SELECT DISTINCT ON (c.story_id)
               rp.chapter_id,
               rp.progress_pct,
               rp.updated_at,
               c.story_id,
               c.order_index AS chapter_num,
               c.title AS chapter_title
        FROM reading_progress rp
        JOIN chapters c ON c.id = rp.chapter_id
        WHERE rp.user_id = $1
        ORDER BY c.story_id, rp.updated_at DESC
      )
      SELECT s.id, s.author_id, s.title, s.description, s.genre, s.image_url, s.is_18_plus, s.completion_status,
             (SELECT COUNT(*) FROM story_views WHERE story_id = s.id) AS readers_count,
             (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE story_id = s.id) AS rating,
             s.created_at,
             u.username AS author_name,
             lr.progress_pct,
             lr.chapter_id,
             lr.chapter_num,
             lr.chapter_title,
             lr.updated_at AS last_read_at
      FROM LastRead lr
      JOIN stories s ON s.id = lr.story_id
      LEFT JOIN users u ON u.id = s.author_id
      WHERE s.status = 'published' AND NOT (
        lr.progress_pct = 100 AND 
        lr.chapter_num = (SELECT MAX(order_index) FROM chapters WHERE story_id = lr.story_id)
      )
      ORDER BY lr.updated_at DESC
    `, [req.params.userId]);
    res.json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Singola storia per UUID (deve stare DOPO le route specifiche)
app.get('/api/stories/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.id, s.author_id, s.title, s.description, s.genre, s.image_url, s.is_18_plus, s.completion_status,
              (SELECT COUNT(*) FROM story_views WHERE story_id = s.id) AS readers_count,
              (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE story_id = s.id) AS rating,
              s.created_at,
              (SELECT COUNT(*) FROM story_likes WHERE story_id = s.id) AS likes_count,
              (SELECT COUNT(*) FROM story_bookmarks WHERE story_id = s.id) AS bookmarks_count,
              u.username AS author_name,
              u.avatar_url AS author_avatar,
              (SELECT COUNT(*) FROM story_views WHERE story_id = s.id) AS views_count
       FROM stories s
       LEFT JOIN users u ON u.id = s.author_id
       WHERE s.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Storia non trovata' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ═══════════════ VIEWS ═══════════════

// Registra una visualizzazione
app.post('/api/views', async (req, res) => {
  const { story_id, user_id } = req.body;
  if (!story_id) return res.status(400).json({ error: 'story_id obbligatorio' });
  try {
    if (user_id) {
      const existing = await pool.query(
        'SELECT 1 FROM story_views WHERE story_id = $1 AND user_id = $2',
        [story_id, user_id]
      );
      if (existing.rows.length > 0) {
        return res.json({ ok: true, duplicate: true });
      }
    }
    await pool.query(
      'INSERT INTO story_views (story_id, user_id) VALUES ($1, $2)',
      [story_id, user_id || null]
    );
    res.json({ ok: true });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ═══════════════ READING PROGRESS ═══════════════

// Leggi progresso per una storia (tutti i capitoli)
app.get('/api/progress/:userId/:storyId', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT rp.chapter_id, rp.progress_pct, rp.updated_at,
             c.order_index, c.title AS chapter_title,
             (SELECT COUNT(*) FROM chapters WHERE story_id = $2) AS total_chapters
      FROM reading_progress rp
      JOIN chapters c ON c.id = rp.chapter_id
      WHERE rp.user_id = $1 AND c.story_id = $2
      ORDER BY c.order_index
    `, [req.params.userId, req.params.storyId]);
    res.json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Salva / aggiorna progresso di lettura
app.post('/api/progress', async (req, res) => {
  const { user_id, chapter_id, progress_pct } = req.body;
  if (!user_id || !chapter_id) return res.status(400).json({ error: 'Parametri mancanti' });
  try {
    await pool.query(`
      INSERT INTO reading_progress (user_id, chapter_id, progress_pct, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id, chapter_id)
      DO UPDATE SET progress_pct = $3, updated_at = NOW()
    `, [user_id, chapter_id, progress_pct ?? 0]);
    res.json({ ok: true });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Cancella / resetta progresso di lettura per una storia
app.delete('/api/progress/:userId/:storyId', async (req, res) => {
  try {
    await pool.query(`
      DELETE FROM reading_progress
      WHERE user_id = $1 AND chapter_id IN (
        SELECT id FROM chapters WHERE story_id = $2
      )
    `, [req.params.userId, req.params.storyId]);
    res.json({ ok: true });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ═══════════════ CHAPTERS ═══════════════

// Lista capitoli di una storia
app.get('/api/stories/:id/chapters', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, title, order_index, status, image_url
      FROM chapters
      WHERE story_id = $1 AND status = 'published'
      ORDER BY order_index
    `, [req.params.id]);
    res.json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Contenuto di un singolo capitolo
app.get('/api/chapters/:id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.title, c.content, c.order_index, c.story_id, COALESCE(c.image_url, s.image_url) AS image_url,
             s.title AS story_title,
             u.username AS author_name,
             (SELECT COUNT(*) FROM chapters WHERE story_id = c.story_id AND status = 'published') AS total_chapters
      FROM chapters c
      JOIN stories s ON s.id = c.story_id
      LEFT JOIN users u ON u.id = s.author_id
      WHERE c.id = $1
    `, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Capitolo non trovato' });
    res.json(result.rows[0]);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ═══════════════ FOLLOWS & AUTHOR ═══════════════

// Segui un utente
app.post('/api/follows', async (req, res) => {
  const { follower_id, followed_id } = req.body;
  try {
    const existing = await pool.query(
      'SELECT 1 FROM follows WHERE follower_id = $1 AND followed_id = $2',
      [follower_id, followed_id]
    );
    if (existing.rows.length === 0) {
      await pool.query(
        'INSERT INTO follows (follower_id, followed_id) VALUES ($1, $2)',
        [follower_id, followed_id]
      );
      
      // Trigger new follower notification
      if (follower_id !== followed_id) {
        const checkPref = await pool.query('SELECT notifiche_nuovo_follower FROM users WHERE id = $1', [followed_id]);
        if (checkPref.rows.length > 0 && checkPref.rows[0].notifiche_nuovo_follower !== false) {
          const senderRes = await pool.query('SELECT username FROM users WHERE id = $1', [follower_id]);
          const senderUsername = senderRes.rows.length > 0 ? senderRes.rows[0].username : 'Qualcuno';
          const message = `${senderUsername} ha iniziato a seguirti`;
          await pool.query(`
            INSERT INTO notifications (user_id, sender_id, type, message)
            VALUES ($1, $2, $3, $4)
          `, [followed_id, follower_id, 'new_follower', message]);
        }
      }
    }
    res.json({ success: true });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Smetti di seguire un utente
app.delete('/api/follows/:followerId/:followedId', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM follows WHERE follower_id = $1 AND followed_id = $2',
      [req.params.followerId, req.params.followedId]
    );
    res.json({ success: true });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Ottieni gli utenti che seguono un autore (Followers)
app.get('/api/follows/followers/:userId', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, u.username as name, u.email as handle, u.bio as description, u.avatar_url,
        (SELECT COUNT(*) FROM stories WHERE author_id = u.id AND status = 'published') as stories_count,
        (SELECT COUNT(*) FROM follows WHERE followed_id = u.id) as followers_count,
        (SELECT COUNT(*) FROM follows WHERE follower_id = u.id) as following_count
      FROM users u
      JOIN follows f ON f.follower_id = u.id
      WHERE f.followed_id = $1
      ORDER BY f.created_at DESC
    `, [req.params.userId]);
    res.json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Ottieni i conteggi di followers e seguiti
app.get('/api/follows/count/:userId', async (req, res) => {
  try {
    const followers = await pool.query('SELECT COUNT(*) FROM follows WHERE followed_id = $1', [req.params.userId]);
    const following = await pool.query('SELECT COUNT(*) FROM follows WHERE follower_id = $1', [req.params.userId]);
    res.json({
      followersCount: parseInt(followers.rows[0].count, 10),
      followingCount: parseInt(following.rows[0].count, 10)
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Ottieni gli autori seguiti da un utente
app.get('/api/follows/:userId', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, u.username as name, u.email as handle, u.avatar_url, u.bio as description,
        f.enable_notifications,
        (SELECT COUNT(*) FROM stories WHERE author_id = u.id AND status = 'published') as stories_count,
        (SELECT COUNT(*) FROM follows WHERE followed_id = u.id) as followers_count,
        (SELECT COUNT(*) FROM follows WHERE follower_id = u.id) as following_count
      FROM users u
      JOIN follows f ON f.followed_id = u.id
      WHERE f.follower_id = $1
      ORDER BY f.created_at DESC
    `, [req.params.userId]);
    res.json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Controlla se un utente ne segue un altro
app.get('/api/follows/check/:followerId/:followedId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT enable_notifications FROM follows WHERE follower_id = $1 AND followed_id = $2',
      [req.params.followerId, req.params.followedId]
    );
    if (result.rows.length > 0) {
      res.json({ following: true, enable_notifications: result.rows[0].enable_notifications });
    } else {
      res.json({ following: false, enable_notifications: true });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Attiva/disattiva notifiche per un autore seguito
app.put('/api/follows/notifications', async (req, res) => {
  const { follower_id, followed_id, enable_notifications } = req.body;
  try {
    const result = await pool.query(`
      UPDATE follows
      SET enable_notifications = $1
      WHERE follower_id = $2 AND followed_id = $3
      RETURNING *
    `, [enable_notifications, follower_id, followed_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Follow relationship not found' });
    }
    res.json({ success: true, follow: result.rows[0] });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Storie di uno specifico autore
app.get('/api/stories/author/:authorId', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.id, s.title, s.description, s.genre, s.image_url, s.is_18_plus, s.completion_status,
             (SELECT COUNT(*) FROM story_views WHERE story_id = s.id) AS readers_count,
             (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE story_id = s.id) AS rating,
             s.created_at,
             u.username AS author_name
      FROM stories s
      JOIN users u ON u.id = s.author_id
      WHERE s.author_id = $1 AND s.status = 'published'
      ORDER BY rating DESC
    `, [req.params.authorId]);
    res.json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ═══════════════ AUTHOR DASHBOARD & EDITOR ═══════════════

// Recupera tutte le storie di un autore (incluse bozze)
app.get('/api/author/my-stories/:userId', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.id, s.title, s.description, s.genre, s.image_url, s.status, s.is_18_plus, s.completion_status,
             (SELECT COUNT(*) FROM story_views WHERE story_id = s.id) AS readers_count,
             (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE story_id = s.id) AS rating,
             s.created_at,
             (SELECT COUNT(*) FROM story_views WHERE story_id = s.id) AS views_count
      FROM stories s
      WHERE s.author_id = $1
      ORDER BY s.id DESC
    `, [req.params.userId]);
    res.json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Crea una nuova storia (bozza)
app.post('/api/stories', async (req, res) => {
  const { author_id, title, genre } = req.body;
  const defaultImage = 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&w=800&q=80';
  try {
    const result = await pool.query(`
      INSERT INTO stories (author_id, title, genre, status, image_url)
      VALUES ($1, $2, $3, 'draft', $4)
      RETURNING *
    `, [author_id, title, genre || 'Romanzo', defaultImage]);
    res.json(result.rows[0]);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Aggiorna una storia
app.put('/api/stories/:id', async (req, res) => {
  let { title, description, genre, image_url, status, is_18_plus, completion_status } = req.body;
  // Se image_url è vuota o non fornita, mantieni quella esistente (COALESCE gestisce null)
  const imageToSave = (image_url && image_url.trim() !== '') ? image_url : null;
  try {
    const oldStoryRes = await pool.query('SELECT * FROM stories WHERE id = $1', [req.params.id]);
    const oldStory = oldStoryRes.rows[0];

    const result = await pool.query(`
      UPDATE stories
      SET title = COALESCE($1, title),
          description = COALESCE($2, description),
          genre = COALESCE($3, genre),
          image_url = COALESCE($4, image_url),
          status = COALESCE($5, status),
          is_18_plus = COALESCE($6, is_18_plus),
          completion_status = COALESCE($7, completion_status)
      WHERE id = $8
      RETURNING *
    `, [
      title, 
      description, 
      genre, 
      imageToSave, 
      status, 
      is_18_plus !== undefined ? is_18_plus : null,
      completion_status || null,
      req.params.id
    ]);
    const updatedStory = result.rows[0];

    if (oldStory && updatedStory) {
      if (oldStory.status === 'draft' && updatedStory.status === 'published') {
        triggerNotifications({
          senderId: updatedStory.author_id,
          storyId: updatedStory.id,
          type: 'new_story'
        });
      } else if (oldStory.status === 'published' && updatedStory.status === 'published') {
        triggerNotifications({
          senderId: updatedStory.author_id,
          storyId: updatedStory.id,
          type: 'update_story'
        });
      }
    }

    res.json(updatedStory);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Elimina una storia
app.delete('/api/stories/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM chapters WHERE story_id = $1', [req.params.id]);
    await pool.query('DELETE FROM stories WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Recupera i capitoli di una storia (per l'editor - include bozze)
app.get('/api/author/stories/:id/chapters', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM chapters WHERE story_id = $1 ORDER BY order_index ASC
    `, [req.params.id]);
    res.json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Crea un nuovo capitolo
app.post('/api/chapters', async (req, res) => {
  const { story_id, title, content, order_index } = req.body;
  const defaultImage = 'https://images.unsplash.com/photo-1455390582262-044cdead2708?auto=format&fit=crop&w=800&q=80';
  try {
    const result = await pool.query(`
      INSERT INTO chapters (story_id, title, content, order_index, status, image_url)
      VALUES ($1, $2, $3, $4, 'published', $5)
      RETURNING *
    `, [story_id, title || 'Nuovo Capitolo', content || '', order_index || 1, defaultImage]);
    const newChapter = result.rows[0];

    const storyRes = await pool.query('SELECT * FROM stories WHERE id = $1', [story_id]);
    const story = storyRes.rows[0];

    if (story && story.status === 'published' && newChapter.status === 'published') {
      triggerNotifications({
        senderId: story.author_id,
        storyId: story.id,
        chapterId: newChapter.id,
        type: 'new_chapter'
      });
    }

    res.json(newChapter);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Aggiorna un capitolo
app.put('/api/chapters/:id', async (req, res) => {
  let { title, content, status, image_url } = req.body;
  // Se image_url è vuota o non fornita, mantieni quella esistente (COALESCE gestisce null)
  const imageToSave = (image_url && image_url.trim() !== '') ? image_url : null;
  try {
    const oldChapterRes = await pool.query('SELECT * FROM chapters WHERE id = $1', [req.params.id]);
    const oldChapter = oldChapterRes.rows[0];

    const result = await pool.query(`
      UPDATE chapters
      SET title = COALESCE($1, title),
          content = COALESCE($2, content),
          status = COALESCE($3, status),
          image_url = COALESCE($4, image_url)
      WHERE id = $5
      RETURNING *
    `, [title, content, status, imageToSave, req.params.id]);
    const updatedChapter = result.rows[0];

    if (oldChapter && updatedChapter) {
      const storyRes = await pool.query('SELECT * FROM stories WHERE id = $1', [updatedChapter.story_id]);
      const story = storyRes.rows[0];

      if (story && story.status === 'published') {
        if (oldChapter.status === 'draft' && updatedChapter.status === 'published') {
          triggerNotifications({
            senderId: story.author_id,
            storyId: story.id,
            chapterId: updatedChapter.id,
            type: 'new_chapter'
          });
        } else if (oldChapter.status === 'published' && updatedChapter.status === 'published') {
          triggerNotifications({
            senderId: story.author_id,
            storyId: story.id,
            chapterId: updatedChapter.id,
            type: 'update_chapter'
          });
        }
      }
    }

    res.json(updatedChapter);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Elimina un capitolo
app.delete('/api/chapters/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM chapters WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ── NOTIFICATIONS ENDPOINTS ──

app.get('/api/notifications/:userId', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        n.id, n.user_id, n.sender_id, n.story_id, n.chapter_id, n.community_post_id, n.type, n.message, n.is_read, n.created_at,
        u.username as sender_username, u.avatar_url as sender_avatar,
        s.title as story_title, s.image_url as story_image
      FROM notifications n
      JOIN users u ON n.sender_id = u.id
      LEFT JOIN stories s ON n.story_id = s.id
      WHERE n.user_id = $1
      ORDER BY n.created_at DESC
    `, [req.params.userId]);
    res.json(result.rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.put('/api/notifications/:id/read', async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE notifications
      SET is_read = TRUE
      WHERE id = $1
      RETURNING *
    `, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Notification not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.put('/api/notifications/user/:userId/read-all', async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE notifications
      SET is_read = TRUE
      WHERE user_id = $1
      RETURNING *
    `, [req.params.userId]);
    res.json({ success: true, count: result.rowCount });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ── COMMUNITY ENDPOINTS ──

app.get('/api/community/posts', async (req, res) => {
  const { userId } = req.query;
  try {
    let showNsfw = false;
    if (userId) {
      const userRes = await pool.query('SELECT visualizza_18plus_community FROM users WHERE id = $1', [userId]);
      if (userRes.rows.length > 0) {
        showNsfw = !!userRes.rows[0].visualizza_18plus_community;
      }
    }

    let query = `
      SELECT 
        cp.id, cp.author_id, cp.title, cp.type, cp.content, cp.story_id, cp.quote, cp.comment_text, cp.feeling, cp.created_at, cp.views_count, cp.post_image, cp.commented_author, cp.commented_text, cp.commented_type,
        u.username as author_username, u.avatar_url as author_avatar,
        s.title as story_title, s.image_url as story_image, s.is_18_plus as story_is_18_plus,
        COALESCE(vc.likes_count, 0)::integer as likes_count,
        COALESCE(vc.dislikes_count, 0)::integer as dislikes_count,
        (SELECT vote FROM community_post_votes cpv WHERE cpv.post_id = cp.id AND cpv.user_id = $1) as user_vote,
        EXISTS(SELECT 1 FROM community_post_bookmarks cpb WHERE cpb.post_id = cp.id AND cpb.user_id = $1) as user_bookmarked,
        COALESCE(cc.comments_count, 0)::integer as comments_count
      FROM community_posts cp
      JOIN users u ON cp.author_id = u.id
      LEFT JOIN stories s ON cp.story_id = s.id
      LEFT JOIN (
        SELECT 
          post_id, 
          COALESCE(SUM(CASE WHEN vote = 'like' THEN 1 ELSE 0 END), 0) as likes_count,
          COALESCE(SUM(CASE WHEN vote = 'dislike' THEN 1 ELSE 0 END), 0) as dislikes_count
        FROM community_post_votes 
        GROUP BY post_id
      ) vc ON vc.post_id = cp.id
      LEFT JOIN (
        SELECT post_id, COUNT(*) as comments_count 
        FROM community_post_comments 
        GROUP BY post_id
      ) cc ON cc.post_id = cp.id
    `;
    
    const queryParams = [userId || null];
    if (!showNsfw) {
      query += ` WHERE (s.is_18_plus IS NULL OR s.is_18_plus = FALSE)`;
    }
    query += ` ORDER BY cp.created_at DESC`;

    const result = await pool.query(query, queryParams);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/community/posts', async (req, res) => {
  let { author_id, title, type, content, story_id, quote, comment_text, feeling, post_image, commented_author, commented_text, commented_type, story_title, story_image } = req.body;
  try {
    const isValidUuid = (uuid) => {
      if (!uuid) return false;
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
    };

    if (story_id && !isValidUuid(story_id)) {
      story_id = null;
    }

    if (story_id) {
      // Check if the story exists in the database
      const checkStory = await pool.query('SELECT id FROM stories WHERE id = $1', [story_id]);
      if (checkStory.rows.length === 0) {
        // story doesn't exist, let's insert a placeholder so the foreign key constraint passes
        const sTitle = story_title || 'Storia condivisa';
        const sImage = story_image || 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&w=800&q=80';
        await pool.query(`
          INSERT INTO stories (id, author_id, title, genre, status, image_url)
          VALUES ($1, $2, $3, 'Romanzo', 'published', $4)
        `, [story_id, author_id, sTitle, sImage]);
      }
    }

    const insertRes = await pool.query(`
      INSERT INTO community_posts (author_id, title, type, content, story_id, quote, comment_text, feeling, post_image, commented_author, commented_text, commented_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      author_id,
      title || null,
      type,
      content || null,
      story_id,
      quote || null,
      comment_text || null,
      feeling || null,
      post_image || null,
      commented_author || null,
      commented_text || null,
      commented_type || null
    ]);

    const newPost = insertRes.rows[0];
    
    // Join author and story details for direct response rendering
    const authorRes = await pool.query('SELECT username, avatar_url FROM users WHERE id = $1', [author_id]);
    newPost.author_username = authorRes.rows[0]?.username;
    newPost.author_avatar = authorRes.rows[0]?.avatar_url;
    newPost.likes_count = 0;
    newPost.dislikes_count = 0;
    newPost.comments_count = 0;
    newPost.user_vote = null;

    if (story_id) {
      const storyRes = await pool.query('SELECT title, image_url, is_18_plus FROM stories WHERE id = $1', [story_id]);
      if (storyRes.rows.length > 0) {
        newPost.story_title = storyRes.rows[0].title;
        newPost.story_image = storyRes.rows[0].image_url;
        newPost.story_is_18_plus = storyRes.rows[0].is_18_plus;
      }
    }

    res.json(newPost);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/community/posts/:id/vote', async (req, res) => {
  const postId = req.params.id;
  const { userId, vote } = req.body; // 'like' or 'dislike'
  try {
    const voteCheck = await pool.query(
      'SELECT vote FROM community_post_votes WHERE post_id = $1 AND user_id = $2',
      [postId, userId]
    );

    let newUserVote = null;

    if (voteCheck.rows.length > 0) {
      const currentVote = voteCheck.rows[0].vote;
      if (currentVote === vote) {
        // Toggle off
        await pool.query(
          'DELETE FROM community_post_votes WHERE post_id = $1 AND user_id = $2',
          [postId, userId]
        );
      } else {
        // Change vote
        await pool.query(
          'UPDATE community_post_votes SET vote = $1 WHERE post_id = $2 AND user_id = $3',
          [vote, postId, userId]
        );
        newUserVote = vote;
      }
    } else {
      // Insert new vote
      await pool.query(
        'INSERT INTO community_post_votes (post_id, user_id, vote) VALUES ($1, $2, $3)',
        [postId, userId, vote]
      );
      newUserVote = vote;
    }

    // Invia notifica se è un upvote ('like') e non un autovoto
    if (newUserVote === 'like') {
      const postRes = await pool.query('SELECT author_id FROM community_posts WHERE id = $1', [postId]);
      if (postRes.rows.length > 0) {
        const postAuthorId = postRes.rows[0].author_id;
        if (postAuthorId !== userId) {
          const senderRes = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
          const senderUsername = senderRes.rows[0]?.username || 'Un utente';

          const authorRes = await pool.query('SELECT notifiche_community_like FROM users WHERE id = $1', [postAuthorId]);
          if (authorRes.rows.length > 0 && authorRes.rows[0].notifiche_community_like) {
            const message = `${senderUsername} ha messo "Mi piace" al tuo post nella community.`;
            await pool.query(`
              INSERT INTO notifications (user_id, sender_id, type, message, community_post_id)
              VALUES ($1, $2, 'community_like', $3, $4)
            `, [postAuthorId, userId, message, postId]);
          }
        }
      }
    }

    // Fetch updated counts
    const countsRes = await pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN vote = 'like' THEN 1 ELSE 0 END), 0)::integer as likes_count,
        COALESCE(SUM(CASE WHEN vote = 'dislike' THEN 1 ELSE 0 END), 0)::integer as dislikes_count
      FROM community_post_votes
      WHERE post_id = $1
    `, [postId]);

    res.json({ 
      success: true, 
      user_vote: newUserVote,
      likes_count: countsRes.rows[0]?.likes_count || 0,
      dislikes_count: countsRes.rows[0]?.dislikes_count || 0
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/community/posts/:id/bookmark', async (req, res) => {
  const postId = req.params.id;
  const { userId } = req.body;
  try {
    const exists = await pool.query(
      'SELECT 1 FROM community_post_bookmarks WHERE user_id = $1 AND post_id = $2',
      [userId, postId]
    );
    if (exists.rows.length > 0) {
      await pool.query(
        'DELETE FROM community_post_bookmarks WHERE user_id = $1 AND post_id = $2',
        [userId, postId]
      );
      res.json({ success: true, bookmarked: false });
    } else {
      await pool.query(
        'INSERT INTO community_post_bookmarks (user_id, post_id) VALUES ($1, $2)',
        [userId, postId]
      );
      res.json({ success: true, bookmarked: true });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/community/posts/:id/comments', async (req, res) => {
  const postId = req.params.id;
  try {
    // Increment post views count when comments drawer is opened
    await pool.query('UPDATE community_posts SET views_count = views_count + 1 WHERE id = $1', [postId]);

    const result = await pool.query(`
      SELECT 
        cpc.id, cpc.post_id, cpc.author_id, cpc.content, cpc.created_at,
        u.username as author_username, u.avatar_url as author_avatar
      FROM community_post_comments cpc
      JOIN users u ON cpc.author_id = u.id
      WHERE cpc.post_id = $1
      ORDER BY cpc.created_at ASC
    `, [postId]);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/community/posts/:id/comments', async (req, res) => {
  const postId = req.params.id;
  const { userId, content } = req.body;
  try {
    const insertRes = await pool.query(`
      INSERT INTO community_post_comments (post_id, author_id, content)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [postId, userId, content]);

    const newComment = insertRes.rows[0];
    const authorRes = await pool.query('SELECT username, avatar_url FROM users WHERE id = $1', [userId]);
    newComment.author_username = authorRes.rows[0]?.username;
    newComment.author_avatar = authorRes.rows[0]?.avatar_url;

    // Invia notifica se non è un self-comment
    const postRes = await pool.query('SELECT author_id FROM community_posts WHERE id = $1', [postId]);
    if (postRes.rows.length > 0) {
      const postAuthorId = postRes.rows[0].author_id;
      if (postAuthorId !== userId) {
        const senderRes = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
        const senderUsername = senderRes.rows[0]?.username || 'Un utente';

        const authorRes = await pool.query('SELECT notifiche_community_commento FROM users WHERE id = $1', [postAuthorId]);
        if (authorRes.rows.length > 0 && authorRes.rows[0].notifiche_community_commento) {
          const message = `${senderUsername} ha commentato il tuo post nella community.`;
          await pool.query(`
            INSERT INTO notifications (user_id, sender_id, type, message, community_post_id)
            VALUES ($1, $2, 'community_comment', $3, $4)
          `, [postAuthorId, userId, message, postId]);
        }
      }
    }

    res.json(newComment);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.delete('/api/community/posts/:id', async (req, res) => {
  const postId = req.params.id;
  try {
    // Delete referenced records in dependent tables
    await pool.query('DELETE FROM community_post_votes WHERE post_id = $1', [postId]);
    await pool.query('DELETE FROM community_post_bookmarks WHERE post_id = $1', [postId]);
    await pool.query('DELETE FROM community_post_comments WHERE post_id = $1', [postId]);
    await pool.query('DELETE FROM notifications WHERE community_post_id = $1', [postId]);
    
    // Delete the main post
    await pool.query('DELETE FROM community_posts WHERE id = $1', [postId]);
    
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

