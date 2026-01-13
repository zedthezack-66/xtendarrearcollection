import React, { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Check, Loader2, MessageSquare, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface InlineNoteInputProps {
  ticketId: string;
  masterCustomerId: string;
  existingNote?: string;
  existingNoteId?: string;
  existingOutcome?: string;
  lastUpdated?: string;
  onSave: (note: string, isUpdate: boolean, noteId?: string) => Promise<void>;
  isLoading?: boolean;
  className?: string;
}

export function InlineNoteInput({
  ticketId,
  masterCustomerId,
  existingNote = '',
  existingNoteId,
  existingOutcome,
  lastUpdated,
  onSave,
  isLoading = false,
  className,
}: InlineNoteInputProps) {
  const [value, setValue] = useState(existingNote);
  const [isFocused, setIsFocused] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  
  // Sync external changes
  useEffect(() => {
    setValue(existingNote);
  }, [existingNote]);

  const hasChanges = value.trim() !== existingNote.trim();
  const isNew = !existingNoteId;

  const handleSave = async () => {
    if (!value.trim() && isNew) return;
    if (!hasChanges) {
      setIsFocused(false);
      return;
    }
    
    setIsSaving(true);
    try {
      await onSave(value.trim(), !isNew, existingNoteId);
      setIsFocused(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setValue(existingNote);
    setIsFocused(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  const formatDateTime = (date: string) => {
    return new Date(date).toLocaleDateString('en-GB', { 
      day: '2-digit', 
      month: 'short', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  return (
    <div 
      className={cn(
        'flex items-start gap-2 pl-6 transition-all',
        className
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <MessageSquare className={cn(
        'h-4 w-4 mt-2 flex-shrink-0 transition-colors',
        existingNote ? 'text-info' : 'text-muted-foreground/50'
      )} />
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {existingOutcome && !isFocused && (
            <span className="text-xs font-medium text-foreground/70 bg-muted px-1.5 py-0.5 rounded">
              [{existingOutcome}]
            </span>
          )}
          
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={(e) => {
              // Don't blur if clicking on save/cancel buttons
              if (e.relatedTarget?.closest('.inline-note-actions')) return;
              // Auto-save on blur if there are changes
              if (hasChanges) {
                handleSave();
              } else {
                setIsFocused(false);
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder="Add notes..."
            disabled={isLoading || isSaving}
            className={cn(
              'h-8 text-sm transition-all border-transparent bg-transparent',
              'hover:bg-muted/50 hover:border-border',
              'focus:bg-background focus:border-input',
              !existingNote && !isFocused && 'text-muted-foreground/50 italic',
              existingNote && 'text-foreground'
            )}
          />
          
          {/* Action buttons - show when focused and has changes */}
          {isFocused && hasChanges && (
            <div className="inline-note-actions flex items-center gap-1 flex-shrink-0">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-success hover:text-success hover:bg-success/10"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={handleCancel}
                disabled={isSaving}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          
          {/* Loading indicator */}
          {isLoading && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground flex-shrink-0" />
          )}
        </div>
        
        {/* Timestamp - show when not focused and has existing note */}
        {!isFocused && lastUpdated && existingNote && (
          <span className="text-xs text-muted-foreground/60 ml-1">
            Updated {formatDateTime(lastUpdated)}
          </span>
        )}
      </div>
    </div>
  );
}
