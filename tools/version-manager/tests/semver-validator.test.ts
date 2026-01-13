import { validateSemver, parseSemver } from '../src/semver-validator';
import { VersionError } from '../src/errors';

describe('semver-validator', () => {
  describe('validateSemver', () => {
    describe('valid versions', () => {
      it('should accept basic semver (1.0.0)', () => {
        expect(() => validateSemver('1.0.0')).not.toThrow();
      });

      it('should accept version with double digits', () => {
        expect(() => validateSemver('10.20.30')).not.toThrow();
      });

      it('should accept version with pre-release', () => {
        expect(() => validateSemver('1.0.0-alpha')).not.toThrow();
        expect(() => validateSemver('1.0.0-alpha.1')).not.toThrow();
        expect(() => validateSemver('1.0.0-beta.2')).not.toThrow();
      });

      it('should accept version with build metadata', () => {
        expect(() => validateSemver('1.0.0+build.123')).not.toThrow();
        expect(() => validateSemver('1.0.0+20130313144700')).not.toThrow();
      });

      it('should accept version with pre-release and build', () => {
        expect(() => validateSemver('1.0.0-alpha.1+build.123')).not.toThrow();
      });

      it('should accept zero versions', () => {
        expect(() => validateSemver('0.0.0')).not.toThrow();
        expect(() => validateSemver('0.1.0')).not.toThrow();
        expect(() => validateSemver('1.0.0')).not.toThrow();
      });
    });

    describe('invalid versions', () => {
      it('should reject single digit version', () => {
        expect(() => validateSemver('1')).toThrow(VersionError);
      });

      it('should reject two digit version', () => {
        expect(() => validateSemver('1.0')).toThrow(VersionError);
      });

      it('should reject version with leading zeros', () => {
        expect(() => validateSemver('01.0.0')).toThrow(VersionError);
        expect(() => validateSemver('1.02.0')).toThrow(VersionError);
        expect(() => validateSemver('1.0.03')).toThrow(VersionError);
      });

      it('should reject version with letters in core', () => {
        expect(() => validateSemver('1.a.0')).toThrow(VersionError);
        expect(() => validateSemver('v1.0.0')).toThrow(VersionError);
      });

      it('should reject empty string', () => {
        expect(() => validateSemver('')).toThrow(VersionError);
      });

      it('should reject version with spaces', () => {
        expect(() => validateSemver('1.0.0 ')).toThrow(VersionError);
        expect(() => validateSemver(' 1.0.0')).toThrow(VersionError);
      });

      it('should reject version with extra dots', () => {
        expect(() => validateSemver('1.0.0.0')).toThrow(VersionError);
      });
    });

    describe('error details', () => {
      it('should include invalid version in error details', () => {
        try {
          validateSemver('invalid');
          fail('Expected error to be thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(VersionError);
          expect((error as VersionError).details.invalidVersion).toBe('invalid');
        }
      });

      it('should include expected format in error details', () => {
        try {
          validateSemver('1.0');
          fail('Expected error to be thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(VersionError);
          expect((error as VersionError).details.expectedFormat).toContain('MAJOR.MINOR.PATCH');
        }
      });
    });
  });

  describe('parseSemver', () => {
    it('should parse basic semver', () => {
      const result = parseSemver('1.2.3');
      expect(result.major).toBe(1);
      expect(result.minor).toBe(2);
      expect(result.patch).toBe(3);
      expect(result.prerelease).toBeUndefined();
      expect(result.build).toBeUndefined();
    });

    it('should parse semver with pre-release', () => {
      const result = parseSemver('1.2.3-alpha.1');
      expect(result.major).toBe(1);
      expect(result.minor).toBe(2);
      expect(result.patch).toBe(3);
      expect(result.prerelease).toBe('alpha.1');
      expect(result.build).toBeUndefined();
    });

    it('should parse semver with build metadata', () => {
      const result = parseSemver('1.2.3+build.123');
      expect(result.major).toBe(1);
      expect(result.minor).toBe(2);
      expect(result.patch).toBe(3);
      expect(result.prerelease).toBeUndefined();
      expect(result.build).toBe('build.123');
    });

    it('should parse semver with pre-release and build', () => {
      const result = parseSemver('1.2.3-alpha.1+build.123');
      expect(result.major).toBe(1);
      expect(result.minor).toBe(2);
      expect(result.patch).toBe(3);
      expect(result.prerelease).toBe('alpha.1');
      expect(result.build).toBe('build.123');
    });

    it('should throw for invalid semver', () => {
      expect(() => parseSemver('invalid')).toThrow(VersionError);
    });
  });
});
