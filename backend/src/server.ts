import express from 'express';
import cors from 'cors';
import { handleSearchStream } from './routes/search.js';
import { handleBook } from './routes/book.js';

const app = express();
const PORT = 4000;

app.use(cors());
app.use(express.json());

app.get('/search/stream', handleSearchStream);
app.post('/book', handleBook);

app.listen(PORT, () => {
  console.log(`milehop backend listening on http://localhost:${PORT}`);
});
