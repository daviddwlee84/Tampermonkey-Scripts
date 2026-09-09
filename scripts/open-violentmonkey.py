#!/usr/bin/env python3
"""Open the official Violentmonkey installation page in a selected browser."""

import argparse
import subprocess
import sys
import webbrowser

GET_IT = "https://violentmonkey.github.io/get-it/"
CHROME_STORE = "https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag"
FIREFOX_STORE = "https://addons.mozilla.org/firefox/addon/violentmonkey/"
EDGE_STORE = "https://microsoftedge.microsoft.com/addons/detail/violentmonkey/eeagobfjdenkkddmbclomhiblgggliao"
BROWSERS = {
    "arc": ("Arc", CHROME_STORE),
    "chrome": ("Google Chrome", CHROME_STORE),
    "edge": ("Microsoft Edge", EDGE_STORE),
    "zen": ("Zen", FIREFOX_STORE),
    "firefox": ("Firefox", FIREFOX_STORE),
}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("browser", nargs="?", default="default", choices=["default", *BROWSERS])
    parser.add_argument("--dry-run", action="store_true", help="Show the page and browser without opening anything")
    args = parser.parse_args(argv)
    app, url = BROWSERS.get(args.browser, ("default browser", GET_IT))
    print(f"{app}: {url}")
    print("Install in the intended browser profile, then use just vm-pack and import its ZIP in Violentmonkey Settings.")
    if args.dry_run:
        return 0
    if args.browser != "default":
        if sys.platform != "darwin":
            print("Named browser opening requires macOS. Open the URL above in your chosen browser.", file=sys.stderr)
            return 1
        result = subprocess.run(["open", "-a", app, url], check=False)
        if result.returncode:
            print(f"Could not open {app}. Check that it is installed, or open the URL manually.", file=sys.stderr)
        return result.returncode
    if not webbrowser.open(url, new=2):
        print("Could not open the default browser. Open the URL above manually.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
