{
  description = "Development environment for MidnightOS / NEAR Evaluation with Gemini CLI";

  inputs = {
    nixpkgs.url = "github:Nixos/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_20
            # Optional: Add other tools needed for NEAR/MidnightOS evaluation
            # rustup
            # wasm-pack
          ];

          shellHook = ''
            # Create a local directory for npm global installs to avoid sudo requirements
            export NPM_CONFIG_PREFIX="$PWD/.npm-global"
            export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"

            echo "🚀 Entering MidnightOS/NEAR Architecture Environment"
            
            # Check if gemini-cli is installed, if not, install it
            if ! command -v gemini &> /dev/null; then
              echo "Installing Gemini CLI..."
              npm install -g @google/gemini-cli
            fi

            echo "✅ Gemini CLI is ready. Run 'gemini' to begin."
            echo "💡 Tip: Reference your GEMINI.md for repository context."
          '';
        };
      }
    );
}
