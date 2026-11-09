"""Run the full synthetic test suite (stdlib unittest only)."""
import sys
import unittest

if __name__ == "__main__":
    sys.path.insert(0, ".")
    suite = unittest.defaultTestLoader.discover("tests", pattern="test_*.py")
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
