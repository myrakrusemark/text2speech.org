import os

def create_favicon():
    # Create a temporary HTML file with the emoji
    html_content = """
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body {
                margin: 0;
                padding: 0;
                display: flex;
                justify-content: center;
                align-items: center;
                width: 32px;
                height: 32px;
                background: transparent;
            }
            div {
                font-size: 24px;
                line-height: 32px;
            }
        </style>
    </head>
    <body>
        <div>🔊</div>
    </body>
    </html>
    """
    
    with open('temp.html', 'w', encoding='utf-8') as f:
        f.write(html_content)
    
    # Use wkhtmltoimage to convert HTML to PNG
    os.system('wkhtmltoimage --quality 100 --width 32 --height 32 temp.html temp.png')
    
    # Use convert to create ICO
    os.system('convert temp.png favicon.ico')
    
    # Clean up temporary files
    os.remove('temp.html')
    os.remove('temp.png')

if __name__ == '__main__':
    create_favicon() 