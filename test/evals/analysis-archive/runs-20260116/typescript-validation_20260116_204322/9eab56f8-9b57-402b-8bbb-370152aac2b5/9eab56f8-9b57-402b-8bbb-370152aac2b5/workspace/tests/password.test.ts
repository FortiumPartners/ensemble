import { checkPasswordStrength } from '../src/index';

describe('checkPasswordStrength', () => {
  describe('score calculation', () => {
    it('should return score 0 for very weak password (empty)', () => {
      const result = checkPasswordStrength('');
      expect(result.score).toBe(0);
      expect(result.label).toBe('very-weak');
    });

    it('should return score 1 for very weak password (short with lowercase)', () => {
      // 'abc' has lowercase (+1) but no minLength, so score = 1
      const result = checkPasswordStrength('abc');
      expect(result.score).toBe(1);
      expect(result.label).toBe('weak');
    });

    it('should return score 2 for password with length + lowercase', () => {
      // 'abcdefgh' has minLength (+1) + lowercase (+1) = 2
      const result = checkPasswordStrength('abcdefgh');
      expect(result.score).toBe(2);
      expect(result.label).toBe('fair');
    });

    it('should return score 2 for password with length + one case', () => {
      const result = checkPasswordStrength('ABCDEFGH');
      expect(result.score).toBe(2);
      expect(result.label).toBe('fair');
    });

    it('should return score 3 for password with length + both cases', () => {
      const result = checkPasswordStrength('Abcdefgh');
      expect(result.score).toBe(3);
      expect(result.label).toBe('strong');
    });

    it('should return score 4 for password meeting all requirements', () => {
      const result = checkPasswordStrength('Abcdefg1!');
      expect(result.score).toBe(4);
      expect(result.label).toBe('very-strong');
    });

    it('should return score 3 for password with length + cases + number', () => {
      const result = checkPasswordStrength('Abcdefg1');
      expect(result.score).toBe(3);
      expect(result.label).toBe('strong');
    });

    it('should return score 3 for password with length + cases + special', () => {
      const result = checkPasswordStrength('Abcdefg!');
      expect(result.score).toBe(3);
      expect(result.label).toBe('strong');
    });
  });

  describe('requirements checking', () => {
    it('should correctly identify minLength requirement', () => {
      const short = checkPasswordStrength('abc');
      expect(short.requirements.minLength).toBe(false);

      const long = checkPasswordStrength('abcdefgh');
      expect(long.requirements.minLength).toBe(true);
    });

    it('should correctly identify uppercase requirement', () => {
      const noUpper = checkPasswordStrength('abcdefgh');
      expect(noUpper.requirements.uppercase).toBe(false);

      const hasUpper = checkPasswordStrength('Abcdefgh');
      expect(hasUpper.requirements.uppercase).toBe(true);
    });

    it('should correctly identify lowercase requirement', () => {
      const noLower = checkPasswordStrength('ABCDEFGH');
      expect(noLower.requirements.lowercase).toBe(false);

      const hasLower = checkPasswordStrength('ABCDEFGh');
      expect(hasLower.requirements.lowercase).toBe(true);
    });

    it('should correctly identify number requirement', () => {
      const noNumber = checkPasswordStrength('abcdefgh');
      expect(noNumber.requirements.number).toBe(false);

      const hasNumber = checkPasswordStrength('abcdefg1');
      expect(hasNumber.requirements.number).toBe(true);
    });

    it('should correctly identify special character requirement', () => {
      const noSpecial = checkPasswordStrength('abcdefgh');
      expect(noSpecial.requirements.specialChar).toBe(false);

      const hasSpecial = checkPasswordStrength('abcdefg!');
      expect(hasSpecial.requirements.specialChar).toBe(true);
    });
  });

  describe('suggestions', () => {
    it('should suggest adding length for short password', () => {
      const result = checkPasswordStrength('abc');
      expect(result.suggestions).toContain('Password should be at least 8 characters long');
    });

    it('should suggest adding uppercase for password without uppercase', () => {
      const result = checkPasswordStrength('abcdefgh');
      expect(result.suggestions).toContain('Add an uppercase letter');
    });

    it('should suggest adding lowercase for password without lowercase', () => {
      const result = checkPasswordStrength('ABCDEFGH');
      expect(result.suggestions).toContain('Add a lowercase letter');
    });

    it('should suggest adding number for password without number', () => {
      const result = checkPasswordStrength('abcdefgh');
      expect(result.suggestions).toContain('Add a number');
    });

    it('should suggest adding special char for password without special', () => {
      const result = checkPasswordStrength('abcdefgh');
      expect(result.suggestions).toContain('Add a special character (!@#$%^&*(),.?":{}|<>)');
    });

    it('should return empty suggestions for strong password', () => {
      const result = checkPasswordStrength('Abcdefg1!');
      expect(result.suggestions).toHaveLength(0);
    });
  });

  describe('special characters', () => {
    const specialChars = ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')', ',', '.', '?', '"', ':', '{', '}', '|', '<', '>'];

    specialChars.forEach((char) => {
      it(`should recognize "${char}" as a special character`, () => {
        const result = checkPasswordStrength(`abcdefg${char}`);
        expect(result.requirements.specialChar).toBe(true);
      });
    });
  });
});
