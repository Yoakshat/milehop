import type { Request, Response } from 'express';
import { bookAlaskaCard } from '../browser/alaska-session.js';

const USE_REAL_ALASKA = process.env.MILEHOP_REAL_ALASKA === '1';

/** POST /book { cardId: string }
 *
 * Mock mode: stub, simulates the delay of a real add-to-cart action.
 *
 * Real mode (MILEHOP_REAL_ALASKA=1): resumes the winning card's live
 * browser tab (opened during /search/stream), selects its return fare
 * (recorded when the card was streamed), and clicks Add to Cart. Stops
 * there — no further checkout/payment; Alaska may prompt for login at or
 * after this point, which is left for the user to handle manually.
 */
export function handleBook(req: Request, res: Response): void {
  const { cardId } = req.body ?? {};
  if (!cardId || typeof cardId !== 'string') {
    res.status(400).json({ error: 'Missing required body field: cardId' });
    return;
  }

  if (USE_REAL_ALASKA) {
    bookAlaskaCard(cardId)
      .then((result) => {
        if (result.ok) {
          res.json({ status: 'added_to_cart' });
        } else {
          res.status(409).json({ status: 'failed', reason: result.reason });
        }
      })
      .catch((err) => {
        res.status(500).json({ status: 'failed', reason: String(err) });
      });
    return;
  }

  setTimeout(() => {
    res.json({ status: 'added_to_cart' });
  }, 600 + Math.round(Math.random() * 400));
}
