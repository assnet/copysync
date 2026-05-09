import { Fragment } from 'react';
import { Link, Typography } from '@mui/material';

interface Props {
  text: string;
  textColor: string;
  variant?: 'body1' | 'body2' | 'caption';
  fontSize?: number;
}

const URL_REGEX = /(https?:\/\/[^\s]+)/gi;

function isUrl(part: string): boolean {
  return /^https?:\/\/\S+$/i.test(part);
}

export function RichMessageText({ text, textColor, variant = 'body2', fontSize = 13.5 }: Props) {
  const lines = text.split('\n');

  return (
    <Typography
      component="div"
      variant={variant}
      sx={{
        color: textColor,
        fontSize,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        overflowWrap: 'anywhere',
        '& a': {
          color: 'inherit',
          textDecoration: 'underline',
          textUnderlineOffset: '2px',
          wordBreak: 'break-all',
        },
      }}
    >
      {lines.map((line, lineIndex) => (
        <Fragment key={`${line}-${lineIndex}`}>
          {line.split(URL_REGEX).map((part, partIndex) => {
            if (!part) return null;

            return isUrl(part) ? (
              <Link
                key={`${part}-${partIndex}`}
                href={part}
                target="_blank"
                rel="noopener noreferrer"
                underline="always"
                color="inherit"
              >
                {part}
              </Link>
            ) : (
              <Fragment key={`${part}-${partIndex}`}>{part}</Fragment>
            );
          })}
          {lineIndex < lines.length - 1 ? <br /> : null}
        </Fragment>
      ))}
    </Typography>
  );
}