"""Flask application entry point for the hex globe demo."""
from flask import Flask, render_template

app = Flask(
    __name__,
    template_folder="worldTD/templates",
    static_folder="worldTD/static",
)


@app.route("/")
def index() -> str:
    """Render the interactive globe page."""
    return render_template("index.html")


if __name__ == "__main__":
    app.run(debug=True)
