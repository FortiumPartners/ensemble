import { summarize } from '../src/summarize';

describe('summarize', () => {
  it('returns the text of the first choice', async () => {
    process.env.SUMMARY_MODEL = 'stand-in-model';
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: 'Short.' } }] });
    const client = { chat: { completions: { create } } } as any;
    await expect(summarize(client, 'A long text.')).resolves.toBe('Short.');
    expect(create).toHaveBeenCalledTimes(1);
  });
});
