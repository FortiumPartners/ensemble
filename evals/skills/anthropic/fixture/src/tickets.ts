export interface Ticket {
  id: string;
  customer: string;
  subject: string;
  body: string;
  /** Hard tickets are escalated by a human before they reach the assistant. */
  escalated: boolean;
}

export function describeTicket(ticket: Ticket): string {
  return `#${ticket.id} from ${ticket.customer}: ${ticket.subject}`;
}
