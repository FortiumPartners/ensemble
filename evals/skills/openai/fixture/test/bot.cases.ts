import { answerQuestion } from '../src/bot';

describe('answerQuestion', () => {
  it('returns the text of the first choice', async () => {
    process.env.BOT_MODEL = 'stand-in-model';
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: 'Hello' } }] });
    const client = { chat: { completions: { create } } } as any;
    await expect(answerQuestion(client, 'hi')).resolves.toBe('Hello');
    expect(create).toHaveBeenCalledTimes(1);
  });
});
