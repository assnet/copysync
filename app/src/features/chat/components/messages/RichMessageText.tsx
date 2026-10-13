import { Fragment } from 'react';
import { Link, Typography } from '@mui/material';
import { splitMentions, useMentionNames } from '../../mentions';

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

function LinkifiedText({ text, keyPrefix }: { text: string; keyPrefix: string }) {
  return (
    <>
      {text.split(URL_REGEX).map((part, partIndex) => {
        if (!part) return null;

        return isUrl(part) ? (
          <Link
            key={`${keyPrefix}-${part}-${partIndex}`}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            underline="always"
            color="inherit"
          >
            {part}
          </Link>
        ) : (
          <Fragment key={`${keyPrefix}-${part}-${partIndex}`}>{part}</Fragment>
        );
      })}
    </>
  );
}

export function RichMessageText({ text, textColor, variant = 'body2', fontSize = 13.5 }: Props) {
  const mentionNames = useMentionNames();
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
        // Menção: mesmo peso visual do WhatsApp Web — nome em destaque, sem mudar a cor
        // do balão, legível tanto no balão de saída (texto branco) quanto no de entrada.
        '& .mention': { fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: '2px', textDecorationColor: 'transparent' },
      }}
    >
      {lines.map((line, lineIndex) => (
        <Fragment key={`${line}-${lineIndex}`}>
          {splitMentions(line, mentionNames).map((segment, segmentIndex) =>
            segment.kind === 'mention' ? (
              <span key={`m-${segment.phone}-${segmentIndex}`} className="mention" title={segment.phone}>
                @{segment.name}
              </span>
            ) : (
              <LinkifiedText key={`t-${segmentIndex}`} text={segment.value} keyPrefix={`${lineIndex}-${segmentIndex}`} />
            ),
          )}
          {lineIndex < lines.length - 1 ? <br /> : null}
        </Fragment>
      ))}
    </Typography>
  );
}
