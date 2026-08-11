"""agency-bot — Discord gateway for Agency OS (spec §9).

Discord is transport only. The bot connects outbound (no ports, no tunnels),
transcribes voice notes, forwards everything to the Agency OS API with a
shared secret, and renders answers/questions back — buttons where options
are known, threads so parallel captures never collide.
"""

import os

import discord
from discord import app_commands
from dotenv import load_dotenv

import api
import voice

load_dotenv()

TOKEN = os.environ["DISCORD_BOT_TOKEN"]
ALLOWED_USER_IDS = {
    int(x) for x in os.environ.get("DISCORD_ALLOWED_USER_IDS", "").split(",") if x.strip()
}

intents = discord.Intents.default()
intents.message_content = True

client = discord.Client(intents=intents)
tree = app_commands.CommandTree(client)


def authorized(user: discord.abc.User) -> bool:
    return user.id in ALLOWED_USER_IDS


class OptionButtons(discord.ui.View):
    """Buttons for capture questions — tapping beats typing on mobile."""

    def __init__(self, channel_ref: str, options: list[str]):
        super().__init__(timeout=1800)
        self.channel_ref = channel_ref
        for opt in options[:25]:
            self.add_item(self._button(opt))

    def _button(self, label: str) -> discord.ui.Button:
        btn: discord.ui.Button = discord.ui.Button(label=label[:80])

        async def on_click(interaction: discord.Interaction):
            if not authorized(interaction.user):
                await interaction.response.defer()
                return
            await interaction.response.defer()
            action = "answer"
            low = label.lower()
            if low == "confirm":
                action = "confirm"
            elif low == "cancel":
                action = "cancel"
            step = await api.capture(self.channel_ref, action, label)
            await render_step(interaction.channel, step)

        btn.callback = on_click
        return btn


async def render_step(channel: discord.abc.Messageable, step: dict) -> None:
    message = step.get("message") or step.get("error") or "(?)"
    options = step.get("options")
    ref = str(getattr(channel, "id", ""))
    view = OptionButtons(ref, options) if options else None
    await channel.send(message, view=view)


@client.event
async def on_message(message: discord.Message):
    if message.author.bot:
        return
    if not authorized(message.author):
        # silently ignore + log — even same-server members (spec §9)
        print(f"ignored message from unauthorized user {message.author.id}")
        return
    if message.content.startswith("/"):
        return  # slash commands are handled by the command tree

    # voice note → transcript → same capture pipeline as text
    text = message.content
    for att in message.attachments:
        if att.content_type and att.content_type.startswith("audio"):
            audio = await att.read()
            text = await voice.transcribe(audio, att.filename)
            await message.channel.send(f"🎙️ Suna: “{text}”")
            break
    if not text:
        return

    # each capture runs in a thread so /today etc. never collide with it
    if isinstance(message.channel, discord.Thread):
        thread = message.channel
    else:
        thread = await message.create_thread(name=text[:60] or "capture")

    step = await api.capture(str(thread.id), "message", text)
    await render_step(thread, step)


def channel_ref(interaction: discord.Interaction) -> str:
    return str(interaction.channel_id)


async def run_command(interaction: discord.Interaction, name: str, args: list[str]):
    if not authorized(interaction.user):
        await interaction.response.defer()
        return
    await interaction.response.defer()
    try:
        result = await api.command(name, args)
    except Exception as e:  # surface API failures instead of dying silently
        result = f"API error: {e}"
    # Discord message cap is 2000 chars
    for i in range(0, len(result), 1900):
        await interaction.followup.send(result[i : i + 1900])


@tree.command(name="cancel", description="Chal rahi capture session band karo")
async def cancel(interaction: discord.Interaction):
    if not authorized(interaction.user):
        await interaction.response.defer()
        return
    await interaction.response.defer()
    step = await api.capture(channel_ref(interaction), "cancel")
    await interaction.followup.send(step.get("message", "Cancelled."))


@tree.command(name="today", description="Aaj ka schedule")
async def today(interaction: discord.Interaction):
    await run_command(interaction, "today", [])


@tree.command(name="week", description="Hafte ka plan + overflow")
async def week(interaction: discord.Interaction):
    await run_command(interaction, "week", [])


@tree.command(name="done", description="Task complete mark karo")
@app_commands.describe(search="Task title ka hissa", minutes="Kitne minute lage (optional)")
async def done(interaction: discord.Interaction, search: str, minutes: int | None = None):
    args = search.split()
    if minutes:
        args.append(str(minutes))
    await run_command(interaction, "done", args)


@tree.command(name="block", description="Task blocked mark karo")
@app_commands.describe(search="Task title ka hissa", wajah="Kis cheez ka intezar hai")
async def block(interaction: discord.Interaction, search: str, wajah: str):
    await run_command(interaction, "block", [search, wajah])


@tree.command(name="client", description="Client ka overview")
@app_commands.describe(slug="Client ka brand slug")
async def client_cmd(interaction: discord.Interaction, slug: str):
    await run_command(interaction, "client", [slug])


@tree.command(name="report", description="Weekly draft banao aur preview dekho")
@app_commands.describe(slug="Client ka brand slug")
async def report(interaction: discord.Interaction, slug: str):
    await run_command(interaction, "report", [slug])


@tree.command(name="approve", description="Draft approve karo — client tak delivery")
@app_commands.describe(report_id="Report ID")
async def approve(interaction: discord.Interaction, report_id: str):
    await run_command(interaction, "approve", [report_id])


@tree.command(name="replan", description="Scheduler manually chalao")
async def replan(interaction: discord.Interaction):
    await run_command(interaction, "replan", [])


@client.event
async def on_ready():
    await tree.sync()
    print(f"agency-bot ready as {client.user}")


if __name__ == "__main__":
    client.run(TOKEN)
