advertiser - publisher

When the bot starts, it does the following:

Tries to see if your id is linked to a wallet already, and if it is, then it shows you the balance. Of all the possible tokens, and the native. I mean, not all tokens, but the major ones. Say Eth native, USDC, USDT, WBTC, DAI.

Bot says - what do you want to advertise? include price, currency, target channel, caption, duration. 

Advertiser replies with whatever sentence they want and bot/server detects if everything is there or anything is lacking. If lacking it asks to include that. If all is there, the bot provides a message and the user has to confirm or try to adjust it. 

Eventually once the user confirms, the bot:

Tries to see if your id is linked to a wallet already, and if it is not it guides you to run the command to create a wallet, also please change from /dev_wallet to /dev_create_wallet. If it is, then it shows you the balance of all non-zero tokens, or native. The set from which the server should look are the major ones. Say Eth native, USDC, USDT, DAI. And it also should show available balance in the escrow contract.
If the balance is zero then it asks you to transfer one of those USDC, USDT, DAI. Once you transfer the amount the bot notifies you on the updated balance.

We are not going to require users to pay any gas, we are going to make it gasless, what we are going to do is, present them the message to sign but in human readable format. Not like object with stuff in it. The ai agent should bring it into a readable format.

Now, for sending to publisher there has to be locked funds. So they get locked once a person sends the offer. 

The channel can accept or decline, in which case both get notification from the bot, or counter offer. The format of the counter offer should also be very flexible. For example it can counter the duration, cost, currency, amount. So the publisher does not have to enter a command mentioning id of the campaign for this.

I think in fact it is worth nothing, that the publisher should be able maybe to target the campaign by replying to the message it contains.

Also, when the bot provides the message. It should provide it in a way that is directly copyable from the mobile phone. Because right now it is impossible to copy a part of the message in the smartphone app.
So, stuff to copy should be sent as a separate message.