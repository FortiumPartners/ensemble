export interface Ticket {
  id: string;
  customer: string;
  subject: string;
  body: string;
}

export function describeTicket(ticket: Ticket): string {
  return `#${ticket.id} from ${ticket.customer}: ${ticket.subject}`;
}
